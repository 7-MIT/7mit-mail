export default class MailComposer { constructor(m) { this.m = m; } compile() { return { getEnvelope: () => ({ from: this.m.from.address, to: [] }), build: (cb) => cb(null, Buffer.from('raw')) }; } }
