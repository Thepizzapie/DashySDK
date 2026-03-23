export class SDKValidationError extends Error {
  constructor(message: string, public readonly field?: string) {
    super(message);
    this.name = "SDKValidationError";
  }
}

export class SDKTimeoutError extends Error {
  constructor(public readonly step: string) {
    super(`LLM call timed out (${step})`);
    this.name = "SDKTimeoutError";
  }
}

export class SDKLLMError extends Error {
  constructor(
    message: string,
    public readonly provider: string,
    public readonly statusCode?: number
  ) {
    super(message);
    this.name = "SDKLLMError";
  }
}

export class SDKConnectorError extends Error {
  constructor(message: string, public readonly sourceType: string) {
    super(message);
    this.name = "SDKConnectorError";
  }
}
