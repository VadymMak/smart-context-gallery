import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getCurrentUser } from '@/lib/auth';
import OpenAI from 'openai';
import { searchImages, loadMetadata, assignProject } from '@/lib/metadata';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

interface ChatAction {
  action: 'search' | 'list_folders' | 'list_projects' | 'move_to_project' | 'stats' | 'help' | 'answer';
  params?: Record<string, unknown>;
}

export async function POST(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { message, history } = await request.json();
  if (!message) {
    return NextResponse.json({ error: 'Missing message' }, { status: 400 });
  }

  try {
    const store = await loadMetadata();
    const userImages = Object.values(store.images).filter((i) => i.key.startsWith(`${user.id}/`));
    const imageCount = userImages.length;
    const folders = [...new Set(userImages.map((i) => i.folder))];
    const projects = [...new Set(userImages.map((i) => i.project).filter((p): p is string => !!p))];

    const systemPrompt = `You are a gallery assistant for a personal illustration gallery.

Current gallery state:
- Total images: ${imageCount}
- Folders: ${folders.join(', ') || 'none'}
- Projects: ${projects.join(', ') || 'none'}

Parse the user's message and return JSON with the action to take:

Available actions:
1. {"action": "search", "params": {"query": "search terms"}}
2. {"action": "list_folders"}
3. {"action": "list_projects"}
4. {"action": "move_to_project", "params": {"query": "search to find images", "project": "project name"}}
5. {"action": "stats"}
6. {"action": "help"}
7. {"action": "answer", "params": {"text": "your response"}}

Respond ONLY with valid JSON. Understand English, Russian, and Ukrainian — respond in the same language as the user.`;

    const gptResponse = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 200,
      messages: [
        { role: 'system', content: systemPrompt },
        ...(history || []).slice(-4).map((h: { role: string; content: string }) => ({
          role: h.role as 'user' | 'assistant',
          content: h.content,
        })),
        { role: 'user', content: message },
      ],
    });

    const actionText = gptResponse.choices[0]?.message?.content || '';
    let action: ChatAction;

    try {
      const jsonStr = actionText.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
      action = JSON.parse(jsonStr);
    } catch {
      action = { action: 'answer', params: { text: 'Sorry, I did not understand. Try "help" for available commands.' } };
    }

    let result: unknown;

    switch (action.action) {
      case 'search': {
        const images = await searchImages(String(action.params?.query || ''), user.id);
        result = {
          type: 'search',
          message: images.length
            ? `Found ${images.length} image(s):`
            : `No images found for "${action.params?.query}"`,
          images: images.map((i) => ({
            key: i.key,
            description: i.description,
            tags: i.tags,
            folder: i.folder,
            project: i.project,
          })),
        };
        break;
      }

      case 'list_folders': {
        result = {
          type: 'text',
          message: folders.length
            ? `Folders:\n${folders.map((f) => {
                const count = userImages.filter((i) => i.folder === f).length;
                return `• ${f} (${count} images)`;
              }).join('\n')}`
            : 'No folders yet.',
        };
        break;
      }

      case 'list_projects': {
        result = {
          type: 'text',
          message: projects.length
            ? `Projects:\n${projects.map((p) => {
                const count = userImages.filter((i) => i.project === p).length;
                return `• ${p} (${count} images)`;
              }).join('\n')}`
            : 'No projects yet. Say "add [images] to project [name]" to create one.',
        };
        break;
      }

      case 'move_to_project': {
        const images = await searchImages(String(action.params?.query || ''), user.id);
        if (images.length === 0) {
          result = { type: 'text', message: `No images found matching "${action.params?.query}"` };
        } else {
          const projectName = String(action.params?.project || 'unnamed');
          await assignProject(images.map((i) => i.key), projectName);
          result = {
            type: 'text',
            message: `Assigned ${images.length} image(s) to project "${projectName}"`,
          };
        }
        break;
      }

      case 'stats': {
        const categories = userImages.reduce<Record<string, number>>((acc, img) => {
          acc[img.category] = (acc[img.category] || 0) + 1;
          return acc;
        }, {});
        const styles = userImages.reduce<Record<string, number>>((acc, img) => {
          acc[img.style] = (acc[img.style] || 0) + 1;
          return acc;
        }, {});

        result = {
          type: 'text',
          message: `Gallery Stats:
• Total: ${imageCount} images
• Folders: ${folders.length} (${folders.join(', ') || 'none'})
• Projects: ${projects.length} (${projects.join(', ') || 'none'})
• Categories: ${Object.entries(categories).map(([k, v]) => `${k}: ${v}`).join(', ') || 'none'}
• Styles: ${Object.entries(styles).map(([k, v]) => `${k}: ${v}`).join(', ') || 'none'}`,
        };
        break;
      }

      case 'help': {
        result = {
          type: 'text',
          message: `Available commands:
• "find cats" or "search watercolor" — search by tags/description
• "show folders" — list all folders with counts
• "show projects" — list all projects
• "add cats to project Animals" — assign images to a project
• "stats" — gallery statistics`,
        };
        break;
      }

      default: {
        result = {
          type: 'text',
          message: String((action.params as Record<string, unknown>)?.text || 'How can I help with your gallery?'),
        };
      }
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('[chat] Error:', error);
    return NextResponse.json({ error: 'Chat failed' }, { status: 500 });
  }
}
