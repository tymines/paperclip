export const CONTENT_GENERATOR_UNAVAILABLE_CODE = 'content_generator_unavailable' as const;
export const CONTENT_GENERATOR_UNAVAILABLE_MESSAGE =
  'Content Ideas is disabled: no approved server-owned non-Gemini text-generation capability is configured.' as const;

export class ContentGeneratorUnavailableError extends Error {
  readonly code = CONTENT_GENERATOR_UNAVAILABLE_CODE;

  constructor(readonly retryable = false) {
    super(CONTENT_GENERATOR_UNAVAILABLE_MESSAGE);
    this.name = 'ContentGeneratorUnavailableError';
  }
}

export interface ContentGeneratorUnavailablePayload {
  error: typeof CONTENT_GENERATOR_UNAVAILABLE_MESSAGE;
  code: typeof CONTENT_GENERATOR_UNAVAILABLE_CODE;
  retryable: boolean;
}

export function contentGeneratorUnavailablePayload(
  error: unknown,
): ContentGeneratorUnavailablePayload {
  return {
    error: CONTENT_GENERATOR_UNAVAILABLE_MESSAGE,
    code: CONTENT_GENERATOR_UNAVAILABLE_CODE,
    retryable:
      error instanceof ContentGeneratorUnavailableError ? error.retryable : true,
  };
}

export interface PersonaProfile {
  name: string;
  bio: string | null;
  attributes: Record<string, unknown>;
}

export interface ContentIdea {
  title: string;
  caption: string;
  suggestedHashtags: string[];
}

export function contentGeneratorCapability() {
  return {
    enabled: false as const,
    code: CONTENT_GENERATOR_UNAVAILABLE_CODE,
    reason: CONTENT_GENERATOR_UNAVAILABLE_MESSAGE,
  };
}

/**
 * Content Ideas intentionally remains unavailable until Paperclip has an
 * approved server-owned non-Gemini text-generation abstraction.
 */
export async function generateContentIdeas(
  _persona: PersonaProfile,
  _topic: string,
  _count: number = 5,
): Promise<ContentIdea[]> {
  throw new ContentGeneratorUnavailableError(false);
}
