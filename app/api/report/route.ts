import { NextResponse } from 'next/server';
import {
  geminiModel,
  geminiFlashModel,
  geminiFlashThinkingModel,
} from '@/lib/gemini';
import { reportContentRatelimit } from '@/lib/redis';
import { type Article } from '@/types';
import { CONFIG } from '@/lib/config';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || '',
});

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || '',
});

function logTimeToFile(message: string) {
  const logFilePath = './logs/report_timing_logs.txt';
  fs.appendFileSync(logFilePath, `${message}\n`);
}

function logResponseToFile(response: string) {
  const responseFilePath = './logs/llm_responses.txt';
  fs.appendFileSync(responseFilePath, `${response}\n`);
}

type PlatformModel =
  | 'google__gemini-flash'
  | 'google__gemini-flash-thinking'
  | 'google__gemini-exp'
  | 'gpt-4o'
  | 'o1-mini'
  | 'o1'
  | 'sonnet-3.5'
  | 'haiku-3.5';

async function generateWithGemini(systemPrompt: string, model: string) {
  const startTime = performance.now();
  let result;
  if (model === 'gemini-flash-thinking') {
    result = await geminiFlashThinkingModel.generateContent(systemPrompt);
  } else if (model === 'gemini-exp') {
    result = await geminiModel.generateContent(systemPrompt);
  } else {
    result = await geminiFlashModel.generateContent(systemPrompt);
  }
  const endTime = performance.now();
  const timeLog = `********** Time spent in generateWithGemini (${model}): ${(endTime - startTime).toFixed(2)}ms **********`;
  console.log(timeLog);
  logTimeToFile(timeLog);
  return result.response.text();
}

async function generateWithOpenAI(systemPrompt: string, model: string) {
  const startTime = performance.now();
  const response = await openai.chat.completions.create({
    model,
    messages: [
      {
        role: 'user',
        content: systemPrompt,
      },
    ],
  });
  const endTime = performance.now();
  const timeLog = `********** Time spent in generateWithOpenAI (${model}): ${(endTime - startTime).toFixed(2)}ms **********`;
  console.log(timeLog);
  logTimeToFile(timeLog);
  logResponseToFile(JSON.stringify(response));
  return response.choices[0].message.content;
}

async function generateWithAnthropic(systemPrompt: string, model: string) {
  const startTime = performance.now();
  const response = await anthropic.messages.create({
    model,
    max_tokens: 3500,
    temperature: 0.9,
    messages: [
      {
        role: 'user',
        content: systemPrompt,
      },
    ],
  });
  const endTime = performance.now();
  const timeLog = `********** Time spent in generateWithAnthropic (${model}): ${(endTime - startTime).toFixed(2)}ms **********`;
  console.log(timeLog);
  logTimeToFile(timeLog);
  logResponseToFile(JSON.stringify(response));
  return response.content[0].text || '';
}

export async function POST(request: Request) {
  try {
    const startTime = performance.now();
    const body = await request.json();
    const {
      selectedResults,
      sources,
      prompt,
      platformModel = 'google-gemini-flash',
    } = body as {
      selectedResults: Article[];
      sources: any[];
      prompt: string;
      platformModel: PlatformModel;
    };

    if (CONFIG.rateLimits.enabled) {
      const rateLimitStart = performance.now();
      const { success } = await reportContentRatelimit.limit('report');
      const rateLimitEnd = performance.now();
      const rateLimitTimeLog = `********** Time spent checking rate limits: ${(rateLimitEnd - rateLimitStart).toFixed(2)}ms **********`;
      console.log(rateLimitTimeLog);
      logTimeToFile(rateLimitTimeLog);
      if (!success) {
        return NextResponse.json(
          { error: 'Too many requests' },
          { status: 429 }
        );
      }
    }

    const platform = platformModel.split('__')[0];
    const model = platformModel.split('__')[1];
    const platformConfig =
      CONFIG.platforms[platform as keyof typeof CONFIG.platforms];
    if (!platformConfig?.enabled) {
      return NextResponse.json(
        { error: `${platform} platform is not enabled` },
        { status: 400 }
      );
    }

    const modelConfig = (platformConfig as any).models[model];
    if (!modelConfig) {
      return NextResponse.json(
        { error: `${model} model does not exist` },
        { status: 400 }
      );
    }
    if (!modelConfig.enabled) {
      return NextResponse.json(
        { error: `${model} model is disabled` },
        { status: 400 }
      );
    }

    const generateSystemPrompt = (articles: Article[], userPrompt: string) => {
      return `You are a research assistant tasked with creating a comprehensive report based on multiple sources. 
The report should specifically address this request: "${userPrompt}"

Your report should:
1. Have a clear title that reflects the specific analysis requested
2. Begin with a concise executive summary
3. Be organized into relevant sections based on the analysis requested
4. Use markdown formatting for emphasis, lists, and structure
5. Integrate information from sources naturally without explicitly referencing them by number
6. Maintain objectivity while addressing the specific aspects requested in the prompt
7. Compare and contrast the information from each source, noting areas of consensus or points of contention. 
8. Showcase key insights, important data, or innovative ideas.

Here are the source articles to analyze:

${articles
  .map(
    (article) => `
Title: ${article.title}
URL: ${article.url}
Content: ${article.content}
---
`
  )
  .join('\n')}

Format the report as a JSON object with the following structure:
{
  "title": "Report title",
  "summary": "Executive summary (can include markdown)",
  "sections": [
    {
      "title": "Section title",
      "content": "Section content with markdown formatting"
    }
  ]
}

Use markdown formatting in the content to improve readability:
- Use **bold** for emphasis
- Use bullet points and numbered lists where appropriate
- Use headings and subheadings with # syntax
- Include code blocks if relevant
- Use > for quotations
- Use --- for horizontal rules where appropriate

Important: Do not use phrases like "Source 1" or "According to Source 2". Instead, integrate the information naturally into the narrative or reference sources by their titles when necessary.`;
    };

    const systemPrompt = generateSystemPrompt(selectedResults, prompt);

    console.log('Sending prompt to model:', systemPrompt);

    let response: string | null = null;
    const modelStartTime = performance.now();

    try {
      switch (model) {
        case 'gemini-flash':
          response = await generateWithGemini(systemPrompt, 'gemini-flash');
          break;
        case 'gemini-flash-thinking':
          response = await generateWithGemini(
            systemPrompt,
            'gemini-flash-thinking'
          );
          break;
        case 'gemini-exp':
          response = await generateWithGemini(systemPrompt, 'gemini-exp');
          break;
        case 'gpt-4o':
          response = await generateWithOpenAI(systemPrompt, 'gpt-4o');
          break;
        case 'gpt-4o-mini':
          response = await generateWithOpenAI(systemPrompt, 'gpt-4o-mini');
          break;
        case 'o1-mini':
          response = await generateWithOpenAI(systemPrompt, 'o1-mini');
          break;
        case 'o1':
          response = await generateWithOpenAI(systemPrompt, 'o1');
          break;
        case 'sonnet-3.5':
          response = await generateWithAnthropic(
            systemPrompt,
            'claude-3-5-sonnet-latest'
          );
          break;
        case 'haiku-3.5':
          response = await generateWithAnthropic(
            systemPrompt,
            'claude-3-5-haiku-latest'
          );
          break;
        default:
          throw new Error('Invalid platform/model combination');
      }
    } finally {
      const modelEndTime = performance.now();
      const modelTimeLog = `********** Time spent on model generation (${model}): ${(modelEndTime - modelStartTime).toFixed(2)}ms **********`;
      console.log(modelTimeLog);
      logTimeToFile(modelTimeLog);
    }

    if (!response) {
      throw new Error('No response from model');
    }

    logResponseToFile(response);

    const jsonMatch = response.match(/\{[\s\S]*\}/)?.[0];
    if (!jsonMatch) {
      console.error('No JSON found in response');
      return NextResponse.json(
        { error: 'Invalid report format' },
        { status: 500 }
      );
    }

    try {
      const reportData = JSON.parse(jsonMatch);

      reportData.sources = sources;
      console.log('Parsed report data:', reportData);
      const overallEndTime = performance.now();
      const overallTimeLog = `********** Total time for report generation: ${(overallEndTime - startTime).toFixed(2)}ms **********`;
      console.log(overallTimeLog);
      logTimeToFile(overallTimeLog);

      return NextResponse.json(reportData);
    } catch (parseError) {
      console.error('JSON parsing error:', parseError);
      return NextResponse.json(
        { error: 'Failed to parse report format' },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('Report generation error:', error);
    logTimeToFile(`Report generation error: ${error}`);
    return NextResponse.json(
      { error: 'Failed to generate report' },
      { status: 500 }
    );
  }
}
