export default interface IAdapter {
    fetchData(param?: string): Promise<string>;
    buildRSS(res: string): string;
}