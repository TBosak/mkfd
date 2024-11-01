export default class ApiConfig {
    constructor(
    public title?: string,
    public params?: {param: string, description: string}[],
    public baseUrl?: string,
    public apiKey?: string,
    public apiSecret?: string,
    public accessToken?: string,
    public headers?: { [key: string]: string },
    public withCredentials?: boolean,
    public route?: string,
    public contributor?: string){}
}