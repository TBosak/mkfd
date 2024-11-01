import { ApiConfig } from "../models/apiconfig.model.ts";
import IAdapter from "./adapter.interface.ts";

export abstract class BaseAdapter implements IAdapter {
  config: ApiConfig;

  constructor(config: ApiConfig) {
    this.config = config;
  }

  abstract fetchData(param?: string): Promise<string>;
  abstract buildRSS(res: string): string;
}