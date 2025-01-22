import { NextResponse } from 'next/server';
import { fetchContentRatelimit } from '@/lib/redis';
import { CONFIG } from '@/lib/config';
import fs from 'fs';

function logTimeToFile(message: string) {
  const logFilePath = './logs/fetch_timing_logs.txt';
  fs.appendFileSync(logFilePath, `${message}\n`);
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { url } = body;

    if (!url) {
      return NextResponse.json({ error: 'URL is required' }, { status: 400 });
    }

    // Only check rate limit if enabled
    if (CONFIG.rateLimits.enabled) {
      const { success } = await fetchContentRatelimit.limit(url);
      if (!success) {
        return NextResponse.json(
          { error: 'Too many requests' },
          { status: 429 }
        );
      }
    }

    console.log('Fetching content for URL:', url);

    try {
      const startTime = performance.now(); // Start tracking time

      const response = await fetch(
        `https://r.jina.ai/${encodeURIComponent(url)}`
      );

      const endTime = performance.now(); // End tracking time
      const timeSpent = endTime - startTime; // Calculate time in milliseconds

      const timeLog = `********** Time spent fetching content for URL (${url}): ${timeSpent.toFixed(2)}ms **********`;
      console.log(timeLog);
      logTimeToFile(timeLog);

      if (!response.ok) {
        console.warn(`Failed to fetch content for ${url}:`, response.status);
        return NextResponse.json(
          { error: 'Failed to fetch content' },
          { status: response.status }
        );
      }

      const content = await response.text();

      return NextResponse.json({ content, timeSpent: `${timeSpent.toFixed(2)}ms` });
    } catch (error) {
      const errorLog = `Error fetching content for ${url}: ${error}`;
      console.warn(errorLog);
      logTimeToFile(errorLog);
      return NextResponse.json(
        { error: 'Failed to fetch content' },
        { status: 500 }
      );
    }
  } catch (error) {
    const errorLog = `Content fetching error: ${error}`;
    console.error(errorLog);
    logTimeToFile(errorLog);
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
}
