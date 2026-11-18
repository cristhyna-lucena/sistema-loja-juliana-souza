import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { createDatabase } from "@sistema/db";
@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  readonly client = createDatabase(process.env.DATABASE_URL ?? "");
  async onModuleInit() { await this.client.$connect(); }
  async onModuleDestroy() { await this.client.$disconnect(); }
}
