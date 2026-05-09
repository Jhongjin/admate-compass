import { NextResponse } from 'next/server';

/**
 * Hugging Face API test endpoint.
 * Keep responses secret-safe: never return env var names, credential values, or internal debug output.
 */
export async function GET() {
  try {
    const huggingfaceApiKey = process.env.HUGGINGFACE_API_KEY;
    if (!huggingfaceApiKey) {
      return NextResponse.json(
        {
          success: false,
          error: 'Required provider configuration is missing',
        },
        { status: 503 },
      );
    }

    const testPrompt = '안녕하세요. 간단한 인사말을 해주세요.';
    const response = await fetch('https://api-inference.huggingface.co/models/microsoft/DialoGPT-medium', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${huggingfaceApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        inputs: testPrompt,
        parameters: {
          max_length: 100,
          temperature: 0.7,
          do_sample: true,
        },
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      console.error('Hugging Face API error status:', response.status);
      return NextResponse.json(
        {
          success: false,
          error: 'Provider request failed',
        },
        { status: 502 },
      );
    }

    const data = await response.json();

    return NextResponse.json({
      success: true,
      message: 'Hugging Face API test succeeded',
      response: data,
      testPrompt,
    });
  } catch (error) {
    console.error(
      'Hugging Face API test failed:',
      error instanceof Error ? error.name : 'UnknownError',
    );

    return NextResponse.json(
      {
        success: false,
        error: 'Hugging Face API test failed',
      },
      { status: 500 },
    );
  }
}
