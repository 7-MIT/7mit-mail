export class ImapFlow { constructor(o) { globalThis.__imapOpts = o; } async connect() {} async list() { return [{ path: 'Sent', specialUse: '\\Sent', flags: new Set() }]; } async append() { return {}; } async logout() {} close() {} async mailboxCreate() {} }
export const simpleParser = async () => ({});
