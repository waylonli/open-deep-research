import { NextResponse } from 'next/server';
import { searchRatelimit } from '@/lib/redis';
import { CONFIG } from '@/lib/config';
import fs from 'fs';
const BING_ENDPOINT = 'https://api.bing.microsoft.com/v7.0/search';

type TimeFilter = '24h' | 'week' | 'month' | 'year' | 'all';

function getFreshness(timeFilter: TimeFilter): string {
  switch (timeFilter) {
    case '24h':
      return 'Day';
    case 'week':
      return 'Week';
    case 'month':
      return 'Month';
    case 'year':
      return 'Year';
    default:
      return '';
  }
}

function logToFile(message: string) {
  const logFilePath = './logs/search_timing_logs.txt';
  fs.appendFileSync(logFilePath, `${message}\n`);
}

export async function POST(request: Request) {
  try {
    const overallStartTime = performance.now(); // Start tracking overall time

    const body = await request.json();
    const { query, timeFilter = 'all' } = body;

    if (!query) {
      return NextResponse.json(
        { error: 'Query parameter is required' },
        { status: 400 }
      );
    }

    if (CONFIG.rateLimits.enabled) {
      const rateLimitStart = performance.now(); // Start tracking rate limit time
      const { success } = await searchRatelimit.limit(query);
      const rateLimitEnd = performance.now(); // End tracking rate limit time
      const rateLimitTimeLog = `********** Time spent checking rate limits: ${(rateLimitEnd - rateLimitStart).toFixed(2)}ms **********`;
      console.log(rateLimitTimeLog);
      logToFile(rateLimitTimeLog);

      if (!success) {
        return NextResponse.json(
          { error: 'Too many requests' },
          { status: 429 }
        );
      }
    }

    const subscriptionKey = process.env.AZURE_SUB_KEY;
    if (!subscriptionKey) {
      return NextResponse.json(
        { error: 'Search API key not configured' },
        { status: 500 }
      );
    }

    const params = new URLSearchParams({
      q: query,
      count: CONFIG.search.resultsPerPage.toString(),
      mkt: CONFIG.search.market,
      safeSearch: CONFIG.search.safeSearch,
      textFormat: 'HTML',
      textDecorations: 'true',
    });

    const freshness = getFreshness(timeFilter as TimeFilter);
    if (freshness) {
      params.append('freshness', freshness);
    }

    const fetchStartTime = performance.now(); // Start tracking fetch time
    const response = await fetch(`${BING_ENDPOINT}?${params.toString()}`, {
      headers: {
        'Ocp-Apim-Subscription-Key': subscriptionKey,
        'Accept-Language': 'en-US',
      },
    });
    const fetchEndTime = performance.now(); // End tracking fetch time
    const fetchTimeLog = `********** Time spent on Search API fetch: ${(fetchEndTime - fetchStartTime).toFixed(2)}ms **********`;
    console.log(fetchTimeLog);
    logToFile(fetchTimeLog);

    if (!response.ok) {
      throw new Error(`Search API returned ${response.status}`);
    }

    const data = await response.json();

    const overallEndTime = performance.now(); // End tracking overall time
    const overallTimeLog = `********** Total time for search request: ${(overallEndTime - overallStartTime).toFixed(2)}ms **********`;
    console.log(overallTimeLog);
    logToFile(overallTimeLog);

    return NextResponse.json(data);
  } catch (error) {
    console.error('Search API error:', error);
    logToFile(`Search API error: ${error}`);
    return NextResponse.json(
      { error: 'Failed to fetch search results' },
      { status: 500 }
    );
  }
}
