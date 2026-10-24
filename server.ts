import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type } from '@google/genai';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

interface WrittenNoteInput {
  id: string;
  title: string;
  content: string;
  language?: string;
  reminderTime?: string;
  isCompleted?: boolean;
}

export interface GeneratedTaskNotification {
  noteId: string;
  taskTitle: string;
  notificationMessage: string;
  suggestedMinutes: number;
  urgency: 'high' | 'medium' | 'low';
}

function buildFallbackNotifications(notes: WrittenNoteInput[]): GeneratedTaskNotification[] {
  return notes.slice(0, 6).map((n) => {
    const cleanContent = (n.content || '').trim();
    const shortSnippet =
      cleanContent.length > 90 ? `${cleanContent.slice(0, 87)}...` : cleanContent || n.title;
    return {
      noteId: n.id,
      taskTitle: n.title || 'Task Reminder',
      notificationMessage: `Task Alert: Complete "${n.title}" — ${shortSnippet}`,
      suggestedMinutes: 15,
      urgency: 'medium',
    };
  });
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '2mb' }));

  app.post('/api/ai/task-notifications', async (req, res) => {
    try {
      const rawNotes: WrittenNoteInput[] = Array.isArray(req.body?.notes)
        ? req.body.notes
        : [];

      if (rawNotes.length === 0) {
        res.json({ notifications: [], provider: 'gemini-3.8-flash' });
        return;
      }

      const trimmedNotes = rawNotes.slice(0, 8).map((n) => ({
        id: String(n.id || ''),
        title: String(n.title || 'Note').slice(0, 160),
        content: String(n.content || '').slice(0, 600),
        language: String(n.language || 'en-IN'),
        isCompleted: Boolean(n.isCompleted),
      }));

      const ai = getGeminiClient();
      if (!ai) {
        res.json({
          notifications: buildFallbackNotifications(trimmedNotes),
          provider: 'gemini-3.8-flash',
        });
        return;
      }

      const prompt = `You are a smart task & schedule assistant for Notemyday.
Analyze the user's written notes below and create concise, actionable auto-notifications for each task based on what the user wrote.
Keep notificationMessage short, clear, and helpful (under 22 words).
Suggest a reminder time in minutes (5, 15, or 30) and urgency ("high", "medium", or "low").

Written Notes JSON:
${JSON.stringify(trimmedNotes)}`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                noteId: {
                  type: Type.STRING,
                  description: 'The exact id of the written note.',
                },
                taskTitle: {
                  type: Type.STRING,
                  description: 'Short actionable task title.',
                },
                notificationMessage: {
                  type: Type.STRING,
                  description: 'Auto notification message summarizing the task from the written note.',
                },
                suggestedMinutes: {
                  type: Type.INTEGER,
                  description: 'Suggested reminder delay in minutes (5, 15, or 30).',
                },
                urgency: {
                  type: Type.STRING,
                  description: 'high, medium, or low',
                },
              },
              required: [
                'noteId',
                'taskTitle',
                'notificationMessage',
                'suggestedMinutes',
                'urgency',
              ],
            },
          },
        },
      });

      const text = response.text?.trim() || '[]';
      let parsed: GeneratedTaskNotification[] = [];
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = buildFallbackNotifications(trimmedNotes);
      }

      res.json({
        notifications: Array.isArray(parsed) && parsed.length > 0
          ? parsed
          : buildFallbackNotifications(trimmedNotes),
        provider: 'gemini-3.8-flash',
      });
    } catch (error) {
      console.error('Gemini task notification error:', error);
      const rawNotes: WrittenNoteInput[] = Array.isArray(req.body?.notes)
        ? req.body.notes
        : [];
      res.status(200).json({
        notifications: buildFallbackNotifications(rawNotes),
        provider: 'gemini-3.8-flash',
        warning: error instanceof Error ? error.message : 'Used smart local fallback',
      });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*all', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Notemyday server running on http://localhost:${PORT}`);
  });
}

startServer();
