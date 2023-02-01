#!/bin/bash

printf "RESETTING DBs\n"
ts-node ./bench/redis.ts DO_SETUP
ts-node ./bench/postgres.ts DO_SETUP

printf "\n\nTESTING INSERT\n"
hyperfine --warmup 1 --runs 5 "ts-node ./bench/redis.ts SKIP_SCROLL SKIP_DELETE" "ts-node ./bench/postgres.ts SKIP_SCROLL SKIP_DELETE"

printf "\n\nTESTING SCROLLING. This will depend on how many inserts were done earlier.\n"
hyperfine --warmup 1 --runs 5 "ts-node ./bench/redis.ts SKIP_INSERT SKIP_DELETE" "ts-node ./bench/postgres.ts SKIP_INSERT SKIP_DELETE"

printf "\n\nTESTING DELETES\n"
printf "RESETTING DBs\n"
ts-node ./bench/redis.ts DO_SETUP
ts-node ./bench/postgres.ts DO_SETUP
hyperfine --runs 5 "ts-node ./bench/redis.ts SKIP_SCROLL" "ts-node ./bench/postgres.ts SKIP_SCROLL"

# printf "\n\nTESTING ALL\n"
# hyperfine --runs 3 "ts-node ./bench/redis.ts" "ts-node ./bench/postgres.ts"