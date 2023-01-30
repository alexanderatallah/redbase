#!/bin/bash

printf "RESETTING DBs\n"
ts-node ./benchmark/redis.ts SKIP_INSERT
ts-node ./benchmark/postgres.ts SKIP_INSERT

printf "\n\nTESTING INSERT\n"
hyperfine --warmup 1 --runs 3 "ts-node ./benchmark/redis.ts SKIP_SCROLL SKIP_DELETE" "ts-node ./benchmark/postgres.ts SKIP_SCROLL SKIP_DELETE"

printf "\n\nTESTING SCROLLING. This will depend on how many inserts were done earlier.\n"
hyperfine --runs 3 "ts-node ./benchmark/redis.ts SKIP_INSERT SKIP_DELETE" "ts-node ./benchmark/postgres.ts SKIP_INSERT SKIP_DELETE"

printf "\n\nTESTING DELETES\n"
hyperfine --warmup 1 --runs 3 "ts-node ./benchmark/redis.ts SKIP_SCROLL" "ts-node ./benchmark/postgres.ts SKIP_SCROLL"

printf "\n\nTESTING ALL\n"
hyperfine --runs 3 "ts-node ./benchmark/redis.ts" "ts-node ./benchmark/postgres.ts"