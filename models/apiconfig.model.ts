export default class ApiConfig {
  constructor(
    public title?: string,
    public baseUrl?: string,
    public method?: string,
    public route?: string,
    public params?: { [key: string]: string },
    public headers?: { [key: string]: string },
    public body?: any,
    public withCredentials?: boolean,
    public contributor?: string,
    public advanced?: boolean,
  ) {}
}
