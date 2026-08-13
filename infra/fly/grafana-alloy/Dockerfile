# Fly.io app "fleetops-grafana-alloy" — scrapes fleetops-api's /metrics over
# Fly's private network and remote_writes to Grafana Cloud's hosted
# Prometheus (see DEPLOYMENT.md for account setup).
#
# Build from the monorepo root:
#   docker build -f infra/fly/grafana-alloy/Dockerfile -t fleetops-grafana-alloy .

FROM grafana/alloy:v1.18.1
COPY infra/fly/grafana-alloy/config.alloy /etc/alloy/config.alloy
ENTRYPOINT ["/bin/alloy"]
CMD ["run", "--server.http.listen-addr=0.0.0.0:12345", "--storage.path=/var/lib/alloy/data", "/etc/alloy/config.alloy"]
