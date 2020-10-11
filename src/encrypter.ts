import * as crypto from "crypto";

export class Encrypter {
  private algorithm: string;
  private secret: Buffer;
  private ivLength = 16;
  
  constructor(secret: string) {
    this.algorithm = "aes-256-ctr";
    this.secret = crypto.createHash("sha256").update(secret).digest();
  }

  public async random(length = 48): Promise<string> {
    return new Promise((resolve, reject) => {
      crypto.randomBytes(length, function(err, buf) {
        /* istanbul ignore if */
        if (err) {
          reject(err);
        }
        return resolve(buf.toString("hex").slice(0, length));
      })
    });
  }

  public async encrypt(val: string): Promise<string> {
    if (val.length === 0) {
      throw new Error(`Value must be string with non-zero length.`)
    }
    let iv = await this.random(this.ivLength);
    let cipher = crypto.createCipheriv(this.algorithm, this.secret, iv);
    return iv + cipher.update(val, "utf8", "hex") + cipher.final("hex");
  }

  public async decrypt(val: string): Promise<string> {
    try {
    if (val.length === 0) {
      throw new Error(`Value must be string with non-zero length.`)
    }
    let iv = val.slice(0, this.ivLength);
    let encrypted = val.slice(this.ivLength);
    let decipher = crypto.createDecipheriv(this.algorithm, this.secret, iv);
    let results = decipher.update(encrypted, "hex", "utf8") + decipher.final("utf8");
    return results;
    } catch(err) {
      if (err.message === "Invalid IV length") {
        err.message = "Invalid key"
      }
      throw err;
    }
  }
}