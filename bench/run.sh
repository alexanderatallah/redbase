#!/bin/bash

printf "RESETTING DBs\n"
ts-node ./bench/redis.ts DO_SETUP
ts-node ./bench/postgres.ts DO_SETUP

printf "\n\nTESTING INSERT\n"
hyperfine --warmup 1 --runs 5 "ts-node ./bench/redis.ts DO_INSERT" "ts-node ./bench/postgres.ts DO_INSERT"

printf "\n\nTESTING SCROLLING. This will depend on how many inserts were done earlier.\n"
hyperfine --warmup 1 --runs 5 "ts-node ./bench/redis.ts DO_SCROLL" "ts-node ./bench/postgres.ts DO_SCROLL"

# printf "\n\nTESTING MULTI-INDEX SCROLLING. This will depend on how many inserts were done earlier.\n"
# hyperfine --warmup 1 --runs 5 "ts-node ./bench/redis.ts DO_SCROLL SCROLL_MULTIINDEXED" "ts-node ./bench/postgres.ts DO_SCROLL SCROLL_MULTIINDEXED"

printf "\n\nTESTING DELETES\n"
printf "RESETTING DBs\n"
ts-node ./bench/redis.ts DO_SETUP
ts-node ./bench/postgres.ts DO_SETUP
hyperfine --runs 5 "ts-node ./bench/redis.ts DO_INSERT DO_DELETE" "ts-node ./bench/postgres.ts DO_INSERT DO_DELETE"
