export interface ImapConfig {
  host: string;
  port: number;
  tls: boolean;
  user: string;
  encryptedPassword: string;
  folder: string;
}