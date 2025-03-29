export default class ApiConfig {
  constructor(
    public title?: string,
    public baseUrl?: string,
    public method?: string, // 'GET', 'POST', etc.
    public route?: string, // API endpoint or route
    public params?: { [key: string]: string }, // Query parameters
    public headers?: { [key: string]: string }, // HTTP headers
    public body?: any, // Request body for POST, PUT, etc.
    public withCredentials?: boolean,
    public contributor?: string,
  ) {}
}
