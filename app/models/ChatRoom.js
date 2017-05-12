// @flow
import { Record, List } from 'immutable'
import ChatEntry from './ChatEntry'

export const writable = {
  history: 'history',
  lastRead: 'lastRead'
}

export const ChatRoomRecord = Record({
  history: List(),
  lastRead: -1
}, 'ChatRoom')

export default class ChatRoom extends ChatRoomRecord {
  history: List<ChatEntry>

  get unread(): number {
    return this.history.count() - this.lastRead
  }

  get chunks(): Array<Array<ChatEntry>> {
    let contact = null
    let time = 0
    let accu = []
    let chunks = []

    // Cluster the history in consecutive contact chunk
    this.history.forEach(entry => {
      if(contact === null) {
        contact = entry.contact
      }

      if(accu.length > 0 && (entry.contact !== contact || entry.time > time + 60 * 1000)) {
        chunks.push(accu)
        accu = []
        contact = entry.contact
      }

      accu.push(entry)

      time = entry.time
    })

    if(accu.length > 0) {
      chunks.push(accu)
    }

    return chunks
  }
}