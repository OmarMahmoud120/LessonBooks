// Backend/build-only schema compiler. Client entrypoint uses standalone validators.
import { Ajv2020, _ } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import standaloneCode from 'ajv/dist/standalone/index.js';
import lessonSchema from '../specs/lesson/v1.schema.json';
import eventSchema from '../specs/events/v1.schema.json';
export function assertShape(schema: object, value: unknown): void {
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  addFormats(ajv);
  if (!ajv.compile(schema)(value)) throw new Error('Invalid structured model output');
}
export function generateValidators(): string {
  // Construct code references with this Ajv instance's codegen, even when npm
  // hoists ajv-formats beside a different Ajv installation.
  const ajv = new Ajv2020({
    strict: true,
    allErrors: true,
    code: { source: true, formats: _`require("ajv-formats/dist/formats").fullFormats` },
  });
  addFormats(ajv);
  ajv.addSchema(lessonSchema, 'lesson');
  ajv.addSchema(eventSchema, 'event');
  return standaloneCode(ajv, { validateLesson: 'lesson', validateEvent: 'event' });
}
