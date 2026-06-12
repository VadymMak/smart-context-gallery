import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export interface AnalysisResult {
  description: string;
  tags: string[];
  category: string;
  style: string;
  colors: string[];
}

export async function analyzeImage(imageBuffer: Buffer, contentType: string): Promise<AnalysisResult> {
  const base64 = imageBuffer.toString('base64');
  const dataUrl = `data:${contentType};base64,${base64}`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 300,
    messages: [
      {
        role: 'system',
        content: `You analyze illustrations and artwork. Return ONLY valid JSON with these fields:
{
  "description": "1-2 sentence description of what the image shows",
  "tags": ["tag1", "tag2", ...],
  "category": "one of: portrait, landscape, character, animal, still-life, abstract, scene, pattern, other",
  "style": "one of: watercolor, digital, pencil, ink, pastel, acrylic, oil, mixed-media, collage, vector, pixel-art, other",
  "colors": ["color1", "color2", "color3"]
}
Tags should be specific and useful for search (5-10 tags). Include subjects, mood, and themes.
Always respond in English regardless of image content.`,
      },
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: { url: dataUrl, detail: 'low' },
          },
        ],
      },
    ],
  });

  const text = response.choices[0]?.message?.content || '';

  try {
    const jsonStr = text.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    return JSON.parse(jsonStr) as AnalysisResult;
  } catch {
    return {
      description: 'Image uploaded',
      tags: [],
      category: 'other',
      style: 'other',
      colors: [],
    };
  }
}
