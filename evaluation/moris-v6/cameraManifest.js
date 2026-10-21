import { validateManifest } from './manifest.js';
import { HOLE_FORMAT_TAGS } from '../../functions/_lib/moris/v5/retrieval/holeFormatReference.js';

const ORIENTATIONS = new Set(['landscape', 'portrait', 'unknown']);
const GLARE_LEVELS = new Set(['none', 'mild', 'severe', 'unknown']);
const LABEL_STATES = new Set(['approved', 'pending']);
const SAWTOOTH = new Set(['present', 'absent', 'unknown']);
const COUNT_CERTAINTY = new Set(['exact', 'lower_bound', 'unknown']);
const BOUNDARIES = new Set(['closed', 'open']);
// Răng cưa là nhãn presence của một vùng, không đếm từng răng như hole instance.
const FORMATS = new Set([...HOLE_FORMAT_TAGS.filter(tag => tag !== 'rang_cua'), 'unknown']);

function nonempty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function relativeAssetPath(value) {
  return nonempty(value) && !value.startsWith('/') && !value.includes('..') && !/[?:\\]/.test(value);
}

/**
 * Validates added camera/perception labels without changing the frozen V1
 * ranking manifest. This checks labels and provenance, never image accuracy.
 */
export function validateCameraManifest(rows, { requireApproved = false } = {}) {
  const base = validateManifest(rows, { requireApproved });
  let fullSubjectApproved = 0;
  let perceptionApproved = 0;
  let masksAvailable = 0;

  for (const row of rows) {
    if (row.source_kind !== 'camera') continue;
    const capture = row.camera_capture;
    if (!capture || typeof capture !== 'object' || Array.isArray(capture)) {
      throw Error(`Missing camera_capture: ${row.query_id}`);
    }
    for (const key of ['device_model', 'os_name', 'os_version', 'browser_name', 'browser_version']) {
      if (!nonempty(capture[key])) throw Error(`Missing camera_capture.${key}: ${row.query_id}`);
    }
    if (!ORIENTATIONS.has(capture.orientation)) throw Error(`Invalid camera orientation: ${row.query_id}`);
    if (!GLARE_LEVELS.has(capture.glare)) throw Error(`Invalid glare label: ${row.query_id}`);
    if (!Number.isInteger(capture.frame_width_px) || capture.frame_width_px <= 0 ||
        !Number.isInteger(capture.frame_height_px) || capture.frame_height_px <= 0) {
      throw Error(`Invalid camera frame dimensions: ${row.query_id}`);
    }
    if (capture.occluded !== null && typeof capture.occluded !== 'boolean') {
      throw Error(`Invalid occlusion label: ${row.query_id}`);
    }
    if (!LABEL_STATES.has(capture.full_subject_label_status)) {
      throw Error(`Invalid full-subject label status: ${row.query_id}`);
    }
    if (capture.full_subject_label_status === 'approved') {
      if (typeof capture.full_subject !== 'boolean' || !nonempty(capture.full_subject_curator) ||
          !nonempty(capture.full_subject_labelled_at)) {
        throw Error(`Missing full-subject label: ${row.query_id}`);
      }
      fullSubjectApproved++;
    } else if (capture.full_subject !== null) {
      throw Error(`Pending full-subject label must be null: ${row.query_id}`);
    }

    const perception = row.perception_labels;
    if (!perception || !LABEL_STATES.has(perception.status)) {
      throw Error(`Missing perception label status: ${row.query_id}`);
    }
    if (perception.status === 'approved') {
      if (!Array.isArray(perception.instances) || !COUNT_CERTAINTY.has(perception.count_certainty) ||
          !SAWTOOTH.has(perception.sawtooth) || !nonempty(perception.curator) ||
          !nonempty(perception.labelled_at)) {
        throw Error(`Invalid perception labels: ${row.query_id}`);
      }
      const ids = new Set();
      for (const instance of perception.instances) {
        if (!nonempty(instance?.instance_id) || ids.has(instance.instance_id) ||
            !BOUNDARIES.has(instance.boundary) || !FORMATS.has(instance.format_tag)) {
          throw Error(`Invalid perception instance: ${row.query_id}`);
        }
        ids.add(instance.instance_id);
      }
      perceptionApproved++;
    } else if (perception.instances != null) {
      throw Error(`Pending perception instances must be omitted: ${row.query_id}`);
    }

    if (row.mask_annotation != null) {
      const mask = row.mask_annotation;
      if (!relativeAssetPath(mask.path) || !/^[a-f0-9]{64}$/.test(String(mask.sha256 || ''))) {
        throw Error(`Invalid mask annotation: ${row.query_id}`);
      }
      masksAvailable++;
    }
  }

  return {
    ...base,
    camera_label_schema: 'moris_camera_labels_v1',
    full_subject_approved: fullSubjectApproved,
    perception_approved: perceptionApproved,
    masks_available: masksAvailable
  };
}
