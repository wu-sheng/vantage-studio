/*
 * Copyright 2026 The Vantage Studio Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * `vsadmin hash` — produce an argon2id hash for a password, suitable
 * for pasting into a `local.users[].passwordHash` entry in
 * studio.yaml.
 *
 * Usage:
 *   pnpm -F @vantage-studio/bff vsadmin:hash <password>
 *   echo -n 'mypw' | pnpm -F @vantage-studio/bff vsadmin:hash
 *
 * Reading from stdin lets ops avoid leaving the password in shell
 * history. Falls back to argv[2] for quick one-offs.
 */

import argon2 from 'argon2';
import { stdin } from 'node:process';

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8').trim();
}

async function main(): Promise<void> {
  const argvPassword = process.argv[2];
  const password =
    argvPassword !== undefined && argvPassword.length > 0 ? argvPassword : await readStdin();

  if (!password) {
    console.error('vsadmin hash: no password provided (argv[2] or stdin)');
    process.exit(2);
  }

  const hash = await argon2.hash(password, { type: argon2.argon2id });
  process.stdout.write(hash + '\n');
}

main().catch((err: unknown) => {
  console.error('vsadmin hash failed:', err);
  process.exit(1);
});
