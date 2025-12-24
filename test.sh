#!/bin/bash

docker buildx build . --tag typed-worker-test && docker run --rm typed-worker-test
