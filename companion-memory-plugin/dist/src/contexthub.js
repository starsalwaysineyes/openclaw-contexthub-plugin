export class ContextHubHttpClient {
    options;
    constructor(options) {
        this.options = options;
    }
    async query(payload) {
        return this.request("POST", "/v1/query", payload);
    }
    async readRecordLines(recordId, fromLine = 1, limit = 80) {
        return this.request("GET", `/v1/records/${recordId}/lines?from_line=${fromLine}&limit=${limit}`);
    }
    async request(method, path, payload) {
        const headers = { Accept: "application/json" };
        if (payload !== undefined)
            headers["Content-Type"] = "application/json";
        if (this.options.token)
            headers.Authorization = `Bearer ${this.options.token}`;
        const response = await fetch(`${this.options.baseUrl.replace(/\/$/, "")}${path}`, {
            method,
            headers,
            body: payload === undefined ? undefined : JSON.stringify(payload),
        });
        if (!response.ok) {
            const text = await response.text().catch(() => "");
            throw new Error(`ContextHub request failed: ${response.status} ${response.statusText}${text ? ` :: ${text}` : ""}`);
        }
        return (await response.json());
    }
}
