const TRANSFORMERS_CDN =
  "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1";

const MODEL_ID = "onnx-community/dinov2-small";
const MODEL_REVISION = "ef1fb10";
const DIMENSION = 384;

let extractorPromise = null;
let runtimeInfo = null;

function post(type, payload={}) {
  self.postMessage({type, ...payload});
}

function l2Normalize(values) {
  let sum = 0;
  for (const value of values) {
    const n = Number(value);
    sum += n * n;
  }

  const norm = Math.sqrt(sum) || 1;
  return Array.from(values, value => Number(value) / norm);
}

function tensorToClsVector(output) {
  const data = output?.data;
  const dims = Array.isArray(output?.dims) ? output.dims : [];

  if (!data || !Number.isFinite(Number(data.length))) {
    throw new Error("DINOv2 không trả Tensor hợp lệ.");
  }

  const lastDim = Number(dims.at(-1) || 0);

  if (lastDim !== DIMENSION) {
    throw new Error(
      `Sai dimension DINOv2: expected=${DIMENSION}, dims=${JSON.stringify(dims)}`
    );
  }

  // [384]
  if (dims.length === 1 && dims[0] === DIMENSION) {
    return l2Normalize(data);
  }

  // [1, 384]
  if (dims.length === 2 && dims[1] === DIMENSION) {
    return l2Normalize(data.slice(0, DIMENSION));
  }

  // [1, tokens, 384] -> CLS token is token 0.
  if (dims.length === 3 && dims[2] === DIMENSION) {
    return l2Normalize(data.slice(0, DIMENSION));
  }

  // Defensive fallback: first 384 values are the CLS embedding
  // for the supported DINOv2 hidden-state layouts.
  if (data.length >= DIMENSION) {
    return l2Normalize(data.slice(0, DIMENSION));
  }

  throw new Error(`Không đọc được CLS embedding từ dims=${JSON.stringify(dims)}.`);
}

async function createExtractor() {
  const {pipeline} = await import(TRANSFORMERS_CDN);

  const progress_callback = progress => {
    post("progress", {progress});
  };

  const webgpuSupported = !!self.navigator?.gpu;

  if (webgpuSupported) {
    try {
      const extractor = await pipeline(
        "image-feature-extraction",
        MODEL_ID,
        {
          revision: MODEL_REVISION,
          device: "webgpu",
          dtype: "fp16",
          progress_callback
        }
      );

      runtimeInfo = {
        device: "webgpu",
        dtype: "fp16",
        model: MODEL_ID,
        revision: MODEL_REVISION
      };

      return extractor;
    } catch (error) {
      post("runtime-warning", {
        message: `WebGPU không khởi tạo được; chuyển sang WASM q8. ${error?.message || error}`
      });
    }
  }

  const extractor = await pipeline(
    "image-feature-extraction",
    MODEL_ID,
    {
      revision: MODEL_REVISION,
      device: "wasm",
      dtype: "q8",
      progress_callback
    }
  );

  runtimeInfo = {
    device: "wasm",
    dtype: "q8",
    model: MODEL_ID,
    revision: MODEL_REVISION
  };

  return extractor;
}

async function getExtractor() {
  if (!extractorPromise) {
    extractorPromise = createExtractor();
  }

  try {
    return await extractorPromise;
  } catch (error) {
    extractorPromise = null;
    runtimeInfo = null;
    throw error;
  }
}

self.onmessage = async event => {
  const message = event?.data || {};
  const requestId = String(message.requestId || "");

  try {
    if (message.type === "init") {
      await getExtractor();
      post("result", {
        requestId,
        result: {
          ready: true,
          runtime: runtimeInfo
        }
      });
      return;
    }

    if (message.type === "embed") {
      const image = String(message.image || "");
      if (!image) throw new Error("Thiếu ảnh để tạo vector.");

      const extractor = await getExtractor();
      const output = await extractor(image);
      const embedding = tensorToClsVector(output);

      if (embedding.length !== DIMENSION) {
        throw new Error(`Embedding sai dimension: ${embedding.length}.`);
      }

      post("result", {
        requestId,
        result: {
          embedding,
          runtime: runtimeInfo
        }
      });
      return;
    }

    throw new Error(`Worker message type không hỗ trợ: ${message.type}`);
  } catch (error) {
    post("error", {
      requestId,
      error: {
        name: error?.name || "Error",
        message: error?.message || String(error)
      }
    });
  }
};
