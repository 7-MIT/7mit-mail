export class ImapFlow { constructor(o) { globalThis.__imapOpts = o; } async connect() {} async list() { return [{ path: 'Sent', specialUse: '\\Sent', flags: new Set() }]; } async append() { return {}; } async status() { return { messages: 3, unseen: 1 }; } async logout() {} close() {} async mailboxCreate() {} }
export const simpleParser = async () => ({});
