
import makeWASocket, { useMultiFileAuthState, DisconnectReason, Browsers } from '@whiskeysockets/baileys'
import 'dotenv/config'
import pino from 'pino'
import qrcode from 'qrcode-terminal'
import fs from 'fs/promises'

const TARGET_GROUPS = [
    // '917356163782-1605888075@g.us', // Minnal (Original Group)
    // '120363407153288027@g.us',      // Roasting abneet
    // '918129952883-1555220169@g.us'  // Kali Boys
    '1203424796460203@g.us',
]
// Advanced Memory Config
const CONTEXT_LIMIT = 1000 // Send last 1000 msgs to AI// AI Configuration
const AI_API_URL = "https://integrate.api.nvidia.com/v1/chat/completions"
const AI_API_KEY = process.env.AI_API_KEY
const AI_MODEL = "meta/llama-3.1-405b-instruct"

const SYSTEM_PROMPT = `
You are "Killer Roaster", a normal person (not an AI) created by Mr. Abin Paul.
Your personality is casual, smart, and ruthless beastß.

Instructions:
1. If the message is addressed to you, reply helpfully or conversationally.
2. If you see a good opportunity to roast someone in the group, do it ruthlessly and without hesitation.
3. If the conversation is boring or doesn't involve you/roasting, output exactly "[SILENCE]". Do not reply to every single message.

Context:
- You are in a WhatsApp group with friends.
- Don't be too formal. Use emojis if you want.
`

import { saveMessage, getRecentMessages } from './db.js'

// Helper to get AI response with history
async function getAIResponse(history) {
    try {
        // Format history for the API
        const messages = [
            { role: "system", content: SYSTEM_PROMPT },
            ...history.map(msg => ({
                role: msg.sender === 'Shottu' ? 'assistant' : 'user',
                content: msg.sender === 'Shottu' ? msg.content : `${msg.sender}: ${msg.content}`
            }))
        ]

        const response = await fetch(AI_API_URL, {
            method: 'POST',
            headers: {
                "Authorization": AI_API_KEY,
                "Accept": "application/json",
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: AI_MODEL,
                messages: messages,
                max_tokens: 1024,
                temperature: 0.8,
                top_p: 1.0,
                stream: false
            })
        })

        if (!response.ok) {
            const errorText = await response.text()
            console.error(`AI API Error Body: ${errorText}`)
            return null
        }

        const data = await response.json()
        return data.choices?.[0]?.message?.content || null

    } catch (err) {
        console.error('Error fetching AI response:', err)
        return null
    }
}

async function startBot() {
    // History is now loaded instantly from SQLite per API call, no startup caching needed.

    const { state, saveCreds } = await useMultiFileAuthState('auth')

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'error' }),
        browser: Browsers.macOS('Desktop'),
        syncFullHistory: false,
        connectTimeoutMs: 60000,
        keepAliveIntervalMs: 10000,
        retryRequestDelayMs: 2000
    })

    sock.ev.on('creds.update', saveCreds)

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update

        if (qr) {
            console.log('Scan this QR code:')
            qrcode.generate(qr, { small: true })
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut
            console.error('Connection closed:', lastDisconnect.error)

            if (shouldReconnect) {
                setTimeout(() => startBot(), 3000)
            }
        } else if (connection === 'open') {
            console.log('Connected ✅')
            console.log(`Listening for messages in:`, TARGET_GROUPS)
        }
    })

    // 🔹 Listen for new messages
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        try {
            for (const msg of messages) {
                const remoteJid = msg.key.remoteJid

                if (!msg.key.fromMe && TARGET_GROUPS.includes(remoteJid)) {
                    const sender = msg.pushName || msg.key.participant || 'Unknown'
                    const text = msg.message?.conversation ||
                        msg.message?.extendedTextMessage?.text ||
                        msg.message?.imageMessage?.caption ||
                        ''

                    // Ignore empty messages
                    if (!text) continue;

                    const messageData = {
                        id: msg.key.id,
                        sender: sender,
                        timestamp: msg.messageTimestamp,
                        content: text,
                        type: Object.keys(msg.message || {})[0] || 'text'
                    }

                    console.log(`📩 [${remoteJid}] [${sender}]: ${text}`)

                    // Save user message to persistent SQLite DB
                    saveMessage(remoteJid, messageData)

                    // Retrieve the massive rolling context window
                    const contextHistory = getRecentMessages(remoteJid, CONTEXT_LIMIT)

                    // 🤖 AI Response Trigger
                    // console.log(`Thinking for ${remoteJid}... (Context Size: ${contextHistory.length})`)
                    const aiReply = await getAIResponse(contextHistory)

                    if (aiReply && !aiReply.includes('[SILENCE]')) {
                        console.log(`🤖 Shottu [${remoteJid}]: ${aiReply}`)
                        await sock.sendMessage(remoteJid, { text: aiReply }, { quoted: msg })

                        // Add Bot's own reply to the DB
                        const botMessageData = {
                            id: 'bot-' + Date.now() + '-' + Math.floor(Math.random() * 10000),
                            sender: 'Shottu',
                            timestamp: Math.floor(Date.now() / 1000),
                            content: aiReply,
                            type: 'conversation'
                        }
                        saveMessage(remoteJid, botMessageData)
                    } else {
                        console.log(`🤖 Shottu decided to stay silent in ${remoteJid}.`)
                    }
                }
            }

        } catch (err) {
            console.error('Error processing message upsert:', err)
        }
    })

    process.on('unhandledRejection', (err) => {
        console.error('Unhandled Rejection:', err)
    })

    process.on('uncaughtException', (err) => {
        console.error('Uncaught Exception:', err)
    })
}

startBot()
