import { Attachment } from '../types.js';

export interface NormalizedMessage {
  channelName: string;
  senderId: string;
  text: string;
  attachments?: Attachment[];
  sessionKey: string;
}

export interface ChannelAdapter {
  readonly name: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  sendMessage(target: string, text: string): Promise<void>;
  onMessage(handler: (msg: NormalizedMessage) => void): void;
}
