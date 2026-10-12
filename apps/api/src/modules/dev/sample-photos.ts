import fs from 'node:fs/promises';
import path from 'node:path';
import { imageSize } from 'image-size';
import { TECHNICIAN_PHOTO_KINDS, type PhotoKind } from '@champ/shared';

/**
 * Sample technician photos for the dev simulator (F06 spec §5): small JPEGs labelled "SAMPLE — BEFORE" etc.,
 * committed next to this file. Only the simulator module (never mounted in production) reads them.
 */
const DIR = path.resolve(import.meta.dirname, 'sample-photos');

export interface SamplePhoto {
  kind: PhotoKind;
  fileName: string;
  body: Buffer;
  width: number | null;
  height: number | null;
}

let cache: Promise<SamplePhoto[]> | undefined;

/** The five technician kinds (Before, After, Asset, Cluster, Placement), read once. */
export function loadSamplePhotos(): Promise<SamplePhoto[]> {
  cache ??= Promise.all(
    TECHNICIAN_PHOTO_KINDS.map(async (kind) => {
      const fileName = `sample-${kind.toLowerCase()}.jpg`;
      const body = await fs.readFile(path.join(DIR, fileName));
      const size = imageSize(body);
      return { kind, fileName, body, width: size.width ?? null, height: size.height ?? null };
    }),
  );
  return cache;
}

/** OT remarks the simulated SUBMIT stores. */
export const SAMPLE_OT_REMARKS =
  'Sample remarks (simulated): device fitted behind the dashboard, power and ignition wiring checked, GPS fix confirmed.';
