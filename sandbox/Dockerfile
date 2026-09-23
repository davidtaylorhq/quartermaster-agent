# The sandbox the agent works in. Everything here is the same on every run, so
# it is built once rather than assembled on the runner.
FROM debian:stable-slim

ARG TERM_LLM_VERSION=v0.9.55

RUN apt-get update -qq \
 && apt-get install -y -qq --no-install-recommends \
      git openssh-client ca-certificates curl jq \
 && rm -rf /var/lib/apt/lists/*

# uid 1000 so the work tree is readable from the development environment too.
RUN useradd -u 1000 -m -d /home/agent -s /bin/bash agent \
 && install -d -o agent -g agent -m 0700 /home/agent/.ssh

USER agent
ENV PATH=/home/agent/.local/bin:$PATH
# Both installers leave their downloads behind, and a later layer cannot
# remove what an earlier one shipped.
RUN curl -fsSL "https://raw.githubusercontent.com/samsaffron/term-llm/${TERM_LLM_VERSION}/install.sh" | sh \
 && curl -fsSL https://claude.ai/install.sh | bash \
 && du -sh /home/agent/.cache /home/agent/.local /home/agent/.claude 2>/dev/null || true \
 && rm -rf /home/agent/.cache /tmp/* /var/tmp/*

USER root
CMD ["sleep", "infinity"]
