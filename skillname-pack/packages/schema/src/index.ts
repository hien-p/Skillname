import Ajv, { type ErrorObject } from 'ajv'
import addFormats from 'ajv-formats'
import schemaJson from '../skill-v1.schema.json' with { type: 'json' }

const ajv = new Ajv({ allErrors: true, strict: false })
addFormats(ajv)

const compiled = ajv.compile(schemaJson as object)

export interface ValidationResult {
  valid: boolean
  errors: ErrorObject[] | null
}

export function validate(bundle: unknown): ValidationResult {
  const valid = compiled(bundle) as boolean
  return {
    valid,
    errors: valid ? null : (compiled.errors ?? null),
  }
}

export const skillSchema = schemaJson
