/**
 * Error Handling Utilities
 */

export class TranspileError extends Error {
  constructor(
    message: string,
    public readonly location?: { line: number; column: number },
    public readonly code?: string
  ) {
    super(message);
    this.name = 'TranspileError';
  }

  toString(): string {
    if (this.location) {
      return `TranspileError at line ${this.location.line}, column ${this.location.column}: ${this.message}`;
    }
    return `TranspileError: ${this.message}`;
  }
}

export class UnsupportedFeatureError extends TranspileError {
  constructor(feature: string, location?: { line: number; column: number }) {
    super(`Unsupported Solidity feature: ${feature}`, location, 'UNSUPPORTED_FEATURE');
    this.name = 'UnsupportedFeatureError';
  }
}

export class TypeMappingError extends TranspileError {
  constructor(solidityType: string, location?: { line: number; column: number }) {
    super(`Cannot map Solidity type '${solidityType}' to Move`, location, 'TYPE_MAPPING_ERROR');
    this.name = 'TypeMappingError';
  }
}

export class ParseError extends TranspileError {
  constructor(message: string, location?: { line: number; column: number }) {
    super(message, location, 'PARSE_ERROR');
    this.name = 'ParseError';
  }
}

export function formatErrors(errors: Array<{ message: string; location?: { line: number; column: number } }>): string {
  return errors.map(e => {
    if (e.location) {
      return `  Line ${e.location.line}: ${e.message}`;
    }
    return `  ${e.message}`;
  }).join('\n');
}
