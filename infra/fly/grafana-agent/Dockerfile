# Fly.io app "fleetops-grafana-agent" — scrapes fleetops-api's /metrics over
# Fly's private network and remote_writes to Grafana Cloud's hosted
# Prometheus (see DEPLOYMENT.md for account setup).
#
# Build from the monorepo root:
#   docker build -f infra/fly/grafana-agent/Dockerfile -t fleetops-grafana-agent .

FROM grafana/agent:v0.40.4
COPY infra/fly/grafana-agent/agent.yaml /etc/agent/agent.yaml
ENTRYPOINT ["/bin/grafana-agent"]
CMD ["--config.file=/etc/agent/agent.yaml", "--config.expand-env"]
