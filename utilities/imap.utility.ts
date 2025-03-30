import Imap, { Config } from "node-imap";

export async function listImapFolders(config: Config): Promise<string[]> {
  const imap = new Imap({
    user: config.user,
    password: config.password,
    host: config.host,
    port: config.port,
    tls: true,
  });

  const openImapConnection = (): Promise<void> =>
    new Promise((resolve, reject) => {
      imap.once("ready", resolve);
      imap.once("error", reject);
      imap.connect();
    });

  const getMailboxes = (): Promise<Imap.MailBoxes> =>
    new Promise((resolve, reject) => {
      imap.getBoxes((err, boxes) => {
        if (err) reject(err);
        else resolve(boxes);
      });
    });

  const closeConnection = (): Promise<void> =>
    new Promise((resolve) => {
      imap.once("close", resolve);
      imap.end();
    });

  try {
    await openImapConnection();
    const mailboxes = await getMailboxes();
    await closeConnection();

    const flattenFolders = (boxes: Imap.MailBoxes, prefix = ""): string[] => {
      let folders: string[] = [];
      for (const box in boxes) {
        folders.push(prefix + box);
        if (boxes[box].children) {
          folders = folders.concat(
            flattenFolders(
              boxes[box].children!,
              prefix + box + boxes[box].delimiter,
            ),
          );
        }
      }
      return folders;
    };

    return flattenFolders(mailboxes);
  } catch (err) {
    console.error("IMAP Error:", err);
    return [];
  }
}
