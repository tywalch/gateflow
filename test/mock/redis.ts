
import {Callback, Store} from "../../src/gateflowstore";

export default class RedisClientMock implements Store {
  private data: {[key: string]: string} = {};
  public set(key: string, value: string, mode: string, duration: number, cb: Callback<"OK" | undefined> | undefined): boolean {
    this.data[key] = value;
    if (cb) {
      cb(null, undefined);
    }
    return true;
  }
  public get(key: string, cb: Callback<string | null> | undefined): boolean {
    let stored = this.data[key];
    if (cb) {
      cb(null, stored);
    }
    return true;
  }
  public del(key: string, cb: Callback<number> | undefined): boolean {
    if (key in this.data) {
      delete this.data[key];
    }
    if (cb) {
      cb(null, 0);
    }
    return true;
  }
  quit() {}
}

