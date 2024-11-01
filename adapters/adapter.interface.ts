import { ApiConfig } from "../models/apiconfig.model.ts";

export default interface IAdapter {
    config: ApiConfig;
    fetchData(param?: string): Promise<string>;
    buildRSS(res: string): string;
}