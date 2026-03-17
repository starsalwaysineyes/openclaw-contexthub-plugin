export class ContextHubHttpClient {
    options;
    constructor(options) {
        this.options = options;
    }
    async query(payload) {
        return this.request("POST", "/v1/query", payload);
    }
    async grep(payload) {
        return this.request("POST", "/v1/records/grep", payload);
    }
    async listRecords(payload) {
        return this.request("POST", "/v1/records/list", payload);
    }
    async browseRecordTree(payload) {
        return this.request("POST", "/v1/records/tree", payload);
    }
    async getRecord(recordId) {
        return this.request("GET", `/v1/records/${recordId}`);
    }
    async updateRecord(recordId, payload) {
        return this.request("PATCH", `/v1/records/${recordId}`, payload);
    }
    async editRecordText(recordId, payload) {
        return this.request("POST", `/v1/records/${recordId}/edit`, payload);
    }
    async applyRecordPatch(recordId, payload) {
        return this.request("POST", `/v1/records/${recordId}/apply_patch`, payload);
    }
    async readRecordLines(recordId, fromLine = 1, limit = 80) {
        return this.request("GET", `/v1/records/${recordId}/lines?from_line=${fromLine}&limit=${limit}`);
    }
    async importResource(payload) {
        return this.request("POST", "/v1/resources/import", payload);
    }
    async commitSession(payload) {
        return this.request("POST", "/v1/sessions/commit", payload);
    }
    async getDerivationJob(jobId) {
        return this.request("GET", `/v1/derivation-jobs/${jobId}`);
    }
    async listDerivationJobs(payload) {
        return this.request("POST", "/v1/derivation-jobs/list", payload);
    }
    async redriveDerivationJobs(payload) {
        return this.request("POST", "/v1/derivation-jobs/redrive", payload);
    }
    async listRecordLinks(recordId) {
        return this.request("GET", `/v1/records/${recordId}/links`);
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
