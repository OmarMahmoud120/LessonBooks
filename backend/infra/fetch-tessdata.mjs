// Downloads tessdata_best LSTM models, pinned by exact size and sha256, over the
// distribution's fast models. Run at image build time only; fails closed on mismatch.
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
const MODELS = [
  {
    name: 'ara.traineddata',
    bytes: 12603724,
    sha256: 'ab9d157d8e38ca00e7e39c7d5363a5239e053f5b0dbdb3167dde9d8124335896',
  },
  {
    name: 'eng.traineddata',
    bytes: 15400601,
    sha256: '8280aed0782fe27257a68ea10fe7ef324ca0f8d85bd2fd145d1c2b560bcb66ba',
  },
];
const tessdata = process.argv[2];
if (!tessdata || process.argv.length !== 3)
  throw new Error('usage: node fetch-tessdata.mjs <tessdata-dir>');
for (const model of MODELS) {
  const response = await fetch(
    `https://github.com/tesseract-ocr/tessdata_best/raw/main/${model.name}`,
  );
  if (!response.ok) throw new Error(`model_download_failed ${model.name} ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length !== model.bytes) throw new Error(`model_size_mismatch ${model.name}`);
  if (createHash('sha256').update(buffer).digest('hex') !== model.sha256)
    throw new Error(`model_checksum_mismatch ${model.name}`);
  await writeFile(`${tessdata}/${model.name}`, buffer);
  console.log(`installed ${model.name}`);
}
