#!/usr/bin/env node
// Build static assets ra thư mục output riêng cho Cloudflare Pages.
//
// LÝ DO: nếu đặt pages_build_output_dir = "./" thì TOÀN BỘ repo (kể cả .env,
// .dev.vars, sql/, kim-harness/) trở thành static asset và được serve công khai.
// .gitignore KHÔNG có tác dụng với static asset serving của Pages.
//
// Script này chỉ copy allowlist bên dưới => không thể rò secret theo thiết kế.

import { cp, mkdir, rm, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = join(ROOT, "dist");

// Giá trị được phép đưa xuống TRÌNH DUYỆT.
// TUYỆT ĐỐI KHÔNG thêm service_role / admin token / API key vào đây.
// allowlist chứ không phải denylist: thêm biến mới = phải cố ý cho phép.
const PUBLIC_CONFIG_KEYS = [
  "PUBLIC_SUPABASE_URL",
  "PUBLIC_SUPABASE_ANON_KEY",
  "PUBLIC_R2_PUBLIC_URL",
  "PUBLIC_UPLOAD_PRIMARY_URL",
  "PUBLIC_R2_MEDIA_BASE_URL",
  "PUBLIC_R2_WORKER_URL",
  "PUBLIC_REMOVE_BG_WORKER_URL",
  "PUBLIC_MORIS_BROWSER_VECTOR_MODULE_URL",
  "PUBLIC_MORIS_VECTOR_UPSERT_MODULE_URL",
  "PUBLIC_PAGE_LIMIT",
  "PUBLIC_LOGIN_URL",
];

// Fallback mặc định cho môi trường CI build (Cloudflare Pages) khi không có .env/.dev.vars
const DEFAULT_PUBLIC_CONFIG = {
  PUBLIC_SUPABASE_URL: "https://vhsikdgkzecdfopkpzum.supabase.co",
  PUBLIC_SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZoc2lrZGdremVjZGZvcGtwenVtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyNjgyMTcsImV4cCI6MjA5Njg0NDIxN30.bj1yl4azsk8X-V2I1C6l5Qpa0kqt6j0TP4ZCJ3Du0l4",
  PUBLIC_R2_PUBLIC_URL: "https://pub-fe997ecbd0714682b10cba684d175ac8.r2.dev",
  PUBLIC_UPLOAD_PRIMARY_URL: "/api/upload",
  PUBLIC_R2_MEDIA_BASE_URL: "https://pub-fe997ecbd0714682b10cba684d175ac8.r2.dev",
  PUBLIC_R2_WORKER_URL: "https://catalogue-r2-upload-api.pqvinh1999.workers.dev",
  PUBLIC_MORIS_BROWSER_VECTOR_MODULE_URL: "/src/moris/vector/browserDinov2.js",
  PUBLIC_MORIS_VECTOR_UPSERT_MODULE_URL: "/src/moris/vector/chunkedUpsert.js",
  PUBLIC_PAGE_LIMIT: "36",
  PUBLIC_LOGIN_URL: "/api/auth/login"
};

// Khoá chặn cuối: các tên chứa secret tuyệt đối không được lọt vào config.js.
const FORBIDDEN_PUBLIC_PATTERNS = [
  /service[_-]?role/i,
  /secret/i,
  /private/i,
  /admin[_-]?token/i,
  /api[_-]?key/i,
  /password/i,
];

async function loadEnvFile(path) {
  try {
    const text = await readFile(path, "utf8");
    const out = {};
    for (const rawLine of text.split("\n")) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq < 1) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

// Sinh dist/config.js từ .env / .dev.vars.
// Nhờ vậy index.html không còn hardcode URL/key, và deploy chỉ cần đổi .env.
async function generateConfig(env) {
  const config = {};

  for (const key of PUBLIC_CONFIG_KEYS) {
    const value = env[key];
    if (value === undefined || value === "") continue;

    if (FORBIDDEN_PUBLIC_PATTERNS.some((re) => re.test(key))) {
      throw new Error(`Refuse: biến công khai "${key}" trông giống secret.`);
    }
    config[key] = value;
  }

  if (!config.PUBLIC_SUPABASE_URL) {
    console.warn(
      "⚠ Thiếu PUBLIC_SUPABASE_URL trong .env/.dev.vars — config.js sẽ thiếu giá trị."
    );
  }

  const banner =
    "// GENERATED TỰ ĐỘNG bởi tools/build-static.mjs — ĐỪNG SỬA TAY.\n" +
    "// Nguồn: .env / .dev.vars. Chỉ chứa biến PUBLIC_*, không có secret.\n";

  await writeFile(
    join(OUT, "config.js"),
    `${banner}window.MORIS_PUBLIC_CONFIG = Object.freeze(${JSON.stringify(config, null, 2)});\n`,
    "utf8"
  );

  return Object.keys(config).length;
}

// Sinh dist/version.json đồng bộ từ src/version.js
async function generateVersion() {
  const versionFile = join(ROOT, "src", "version.js");
  const raw = await readFile(versionFile, "utf8").catch(() => "");
  const m = raw.match(/APP_VERSION\s*=\s*['"]([^'"]+)['"]/);
  const version = m ? m[1] : "6.1.1";
  const data = {
    version,
    name: "Catalogue AI",
    builtAt: new Date().toISOString()
  };
  await writeFile(join(OUT, "version.json"), JSON.stringify(data, null, 2) + "\n", "utf8");
  return version;
}

// Thư mục/file được phép đưa lên Pages.
const STATIC_ENTRIES = [
  "index.html",
  "tools",
  "src",
  "assets",
  "_headers",
  "_redirects",
  "manifest.webmanifest",
  "sw.js",
  "version.json",
];

// Thư mục/file KHÔNG BAO GIỜ được copy (phòng thủ kép).
const DENY = [
  ".env", ".dev.vars", ".git", ".wrangler", "node_modules",
  "functions", "sql", "kim-harness", "supabase",
  "package.json", "package-lock.json", "tsconfig.json",
  "pipeline_implementation_plan.md", "report.md", "hdsd.md",
];

async function exists(p) {
  try { await stat(p); return true; } catch { return false; }
}

async function main() {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  const env = {
    ...DEFAULT_PUBLIC_CONFIG,
    ...(await loadEnvFile(join(ROOT, ".env"))),
    ...(await loadEnvFile(join(ROOT, ".dev.vars"))),
    ...process.env
  };

  let files = 0;
  for (const entry of STATIC_ENTRIES) {
    if (DENY.includes(entry)) {
      throw new Error(`Refuse: "${entry}" nằm trong DENY lẫn ALLOWLIST`);
    }
    const from = join(ROOT, entry);
    if (!(await exists(from))) continue;

    if (DENY.some((d) => entry === d || entry.startsWith(`${d}/`))) {
      throw new Error(`Refuse: "${entry}" bị DENY chặn`);
    }

    await cp(from, join(OUT, entry), { recursive: true });

    if ((await stat(from)).isFile()) {
      files += 1;
    } else {
      const walk = async (dir) => {
        for (const e of await readdir(dir, { withFileTypes: true })) {
          if (e.name.startsWith(".")) continue;
          const p = join(dir, e.name);
          if (e.isDirectory()) {
            await walk(p);
            continue;
          }
          // Script build/dev KHÔNG được publish lên production.
          if (e.name.endsWith(".mjs")) {
            await rm(p, { force: true });
            continue;
          }
          files += 1;
        }
      };
      await walk(join(OUT, entry));
    }
  }

  const configKeys = await generateConfig(env);
  const version = await generateVersion();
  files += 2;

  // Kiểm tra chốt chặn: không file nào tên dotfile lọt vào dist/
  const leaked = [];
  const scan = async (dir) => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      if (e.name.startsWith(".")) leaked.push(e.name);
      const p = join(dir, e.name);
      if (e.isDirectory()) await scan(p);
    }
  };
  await scan(OUT);
  if (leaked.length) {
    throw new Error(`Phát hiện dotfile trong dist/: ${leaked.join(", ")}`);
  }

  // Chốt chặn cuối: service_role / admin token KHÔNG được xuất hiện trong dist/
  const forbidden = ["service_role", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZoc2lrZGdremVjZGZvcGtwenVtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSJ9"];
  for (const needle of forbidden) {
    const hit = await scanFor(OUT, needle);
    if (hit) throw new Error(`Phát hiện chuỗi nhạy cảm trong dist/: ${hit}`);
  }

  console.log(`✔ build static xong: ${files} file -> dist/`);
  console.log(`✔ config.js: ${configKeys} biến công khai (không có secret)`);
  console.log("  Kiểm tra trước khi deploy:  ls -A dist/");
}

async function scanFor(dir, needle) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      const found = await scanFor(p, needle);
      if (found) return found;
    } else {
      const text = await readFile(p, "utf8").catch(() => "");
      if (text.includes(needle)) return p;
    }
  }
  return null;
}

main().catch((error) => {
  console.error(`✖ ${error.message}`);
  process.exit(1);
});