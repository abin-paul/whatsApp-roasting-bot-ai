import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Initialize SQLite database
const dbPath = path.join(__dirname, 'messages.db')
const db = new Database(dbPath)

// Create the messages table if it doesn't exist
db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        group_id TEXT NOT NULL,
        sender TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        type TEXT NOT NULL
    )
`)

// Create indexes for faster queries
db.exec(`
    CREATE INDEX IF NOT EXISTS idx_group_id ON messages(group_id);
    CREATE INDEX IF NOT EXISTS idx_timestamp ON messages(timestamp);
`)

// Prepared statements for performance
const insertMessageStmt = db.prepare(`
    INSERT OR IGNORE INTO messages (id, group_id, sender, content, timestamp, type)
    VALUES (@id, @group_id, @sender, @content, @timestamp, @type)
`)

const getRecentMessagesStmt = db.prepare(`
    SELECT * FROM messages
    WHERE group_id = ?
    ORDER BY timestamp DESC
    LIMIT ?
`)

/**
 * Save a message to the database
 */
export function saveMessage(groupId, messageData) {
    try {
        insertMessageStmt.run({
            id: messageData.id,
            group_id: groupId,
            sender: messageData.sender,
            content: messageData.content,
            timestamp: messageData.timestamp,
            type: messageData.type
        })
        return true
    } catch (err) {
        console.error('Error saving message to DB:', err)
        return false
    }
}

/**
 * Retrieve recent messages for a group, ordered chronologically
 */
export function getRecentMessages(groupId, limit = 1000) {
    try {
        const messages = getRecentMessagesStmt.all(groupId, limit)
        // Reverse so they are in chronological order (oldest first)
        return messages.reverse()
    } catch (err) {
        console.error('Error retrieving messages from DB:', err)
        return []
    }
}

/**
 * Close the database connection
 */
export function closeDB() {
    db.close()
}
