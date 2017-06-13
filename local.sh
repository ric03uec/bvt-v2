#!/bin/bash -e

exec_container_cmd() {
  docker exec $ONEBOX_NAME bash -c "cd $COMPONENT_DIR && source local.env && $@"
}

setup_envs() {
  readonly COMPONENT="bvt"
  readonly ONEBOX_NAME="$COMPONENT"_onebox
  readonly COMPONENT_DIR="/home/shippable/$COMPONENT"
}

core_tests() {
  exec_container_cmd "npm run doCleanup"
  exec_container_cmd "npm run test-coreAccountLogin"
  exec_container_cmd "npm run test-coreTests"
}

main() {
  setup_envs
  core_tests
}

main