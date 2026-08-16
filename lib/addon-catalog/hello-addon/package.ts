/**
 * The deployment package of the "Hello" add-on: the files that are written to
 * `deployment/addons/hello-addon/` in an instance's deployment repository.
 *
 * This is the payload the install PR carries. It is deliberately verbatim
 * deployment config, not something rendered at install time — the marketplace
 * only decides WHERE it lands, never rewrites it. Every instance therefore
 * receives byte-identical files, and everything instance-specific (domain,
 * namespace, realm) is resolved by helmfile on the cluster through
 * `.Values.global`, not by us.
 *
 * Modelled on the real `deployment/addons/civitas-marketplace/` add-on, minus
 * what a static page does not need: no Keycloak client, no database, no
 * generated secrets.
 *
 * The file contents are plain strings (no `${...}` sequences) so the Go and
 * Helm templating inside them survives the TypeScript template literals
 * untouched.
 */
export const HELLO_ADDON_PACKAGE: Record<string, string> = {
    'README.md': `# Hello Add-on

A minimal add-on used to prove the CIVITAS AppStore install path end to end:
catalogue entry -> pull request -> operator review -> running component.

It serves one static page through nginx and needs nothing from the platform:
no database, no Keycloak client, no generated secrets. The only integration
point is the APISIX route, which also puts the host on the shared ingress and
into the \`apisix-tls\` certificate.

## What the operator gets

| Aspect | Value |
| --- | --- |
| Public address | \`https://hello.<instance domain>\` |
| Image | \`nginxinc/nginx-unprivileged\` (runs as a non-root user) |
| Resources | 1 replica, no persistence, no cluster-wide permissions |

## Removing it

Delete \`deployment/addons/hello-addon/\` and remove \`hello-addon\` from the
\`components\` list of the environment. Nothing else references it.

## Note on the image tag

\`images.yaml\` is the single source for the image and always wins over the
chart's own defaults. It pins a floating \`stable-alpine\` tag so the demo cannot
break when a version is retired; a production add-on should pin an exact
version or digest.
`,

    'civitas-component.yaml': `---
component: helloAddon
parts:
  - name: app
`,

    'charts.yaml': `---
helloAddon:
  app:
    # Local chart shipped with the addon — no external Helm repository, so the
    # install works in restricted municipal networks.
    chart: charts/hello-addon
`,

    'images.yaml': `---
helloAddon:
  app:
    registry: docker.io
    repository: nginxinc/nginx-unprivileged
    tag: 'stable-alpine'
`,

    'default-environment.yaml.gotmpl': `---
helloAddon:
  app:
    enabled: true
    namespace: {{ include "civitas.namespace" (dict "global" .Values.global "suffix" "hello-addon") }}
    subdomain: hello
`,

    'apisix-routes.yaml': `---
hello-addon:
  name: hello-addon
  description: 'Demo add-on installed through the CIVITAS AppStore'
  # Release name is the kebab-cased component plus the part name, see the
  # addon helmfile below; the chart names its Service after the release.
  upstream: hello-addon-app.{{ include "civitas.namespace" (dict "global" .Values.global "suffix" "hello-addon") }}.svc.cluster.local:80 # yamllint disable-line rule:line-length
  uri: /*
  subDomain: hello
  priority: 10
`,

    'helmfile.yaml.gotmpl': `---
# Copy of the generic component helmfile (see components/config-adapters/helmfile.yaml.gotmpl);
# only the bases path differs, because addons live one directory level deeper.
# Kept verbatim rather than trimmed to what this addon uses: an operator should
# recognise it as the platform's own file, and it stays comparable when upstream
# changes it.
bases:
  - "../../../defaults/helm-defaults.yaml"
---
{{- $componentData := (readFile "./civitas-component.yaml" | fromYaml) }}

{{- $root := .Values }}
{{- $component := $componentData.component }}
{{- $parts :=  $componentData.parts }}

repositories:
{{- $alreadyAdded := dict }}
{{- range $parts }}
  {{- $part := . }}
  {{- $repoUrl := index $root.charts $component $part.name "repository" | default "" }}
  {{- if ne $repoUrl "" }}
    {{- $chart := index $root.charts $component $part.name "chart" }}
    {{- $chartParts := splitList "/" $chart }}
    {{- $repoName := index $chartParts 0 }}
    {{- if not (hasKey $alreadyAdded $repoName) }}
      {{- $_ := set $alreadyAdded $repoName true }}
  - name: cc2-{{ $repoName }}
    url: {{ $repoUrl }}
    {{- end }}
  {{- end }}
{{- end }}

releases:
  {{- range $parts }}
  {{- $part := . }}
  {{- /* kebabcase, like components/config-adapters: helm rejects camelCase release names */}}
  {{- $releaseName := printf "%s-%s" ($component | kebabcase) $part.name }}
  {{- $repoUrl := index $root.charts $component $part.name "repository" | default "" }}
  - name: {{ $releaseName }}
    labels:
      release: {{ $releaseName }}
      {{- range $key, $value := (index $part "extraLabels" | default dict) }}
      {{ $key }}: {{ $value }}
      {{- end }}
    namespace: {{ index $root $component $part.name "namespace" }}
    {{- if ne $repoUrl "" }}
    chart: cc2-{{ index $root.charts $component $part.name "chart" }}
    {{- else }}
    chart: {{ index $root.charts $component $part.name "chart" }}
    {{- end }}
    {{- if index $root.charts $component $part.name "version" }}
    version: {{ index $root.charts $component $part.name "version" }}
    {{- end }}
    createNamespace: {{ $root.global.createNamespaces }}
    installed: {{ index $root $component $part.name "enabled" }}
    condition: {{ $component }}.{{ $part.name }}.enabled
    {{- if index $part "needs" }}
    needs:
      {{ range index $part "needs" }}
        {{- $items := splitList "." . -}}
        {{- $depComponent := index $items 0 -}}
        {{- $depPart := index $items 1 -}}
      - {{ index $root $depComponent $depPart "namespace" }}/{{ printf "%s-%s" ($depComponent | kebabcase) $depPart }}
      {{- end }}
    {{- end }}
    {{- if index $part "hooks" }}
    hooks:
      {{- range index $part "hooks" }}
      - {{ . | toYaml | nindent 8 }}
      {{- end }}
    {{- end }}
    values:
      - values/{{ $part.name }}/base-values.yaml.gotmpl
      - values/{{ $part.name }}/{{ $root.global.profile }}-values.yaml.gotmpl
      - {{- index $root $component $part.name "rawValues" | default dict | toYaml | nindent 8 }}
  {{- end }}

commonLabels:
  component: {{ $component }}
`,

    'values/app/base-values.yaml.gotmpl': `---
{{- $this := .Values.helloAddon.app }}
{{- $global := .Values.global }}

image:
  registry: {{ .Values.images.helloAddon.app.registry }}
  repository: {{ .Values.images.helloAddon.app.repository }}
  tag: {{ .Values.images.helloAddon.app.tag }}
  pullPolicy: IfNotPresent

{{- $host := printf "%s.%s" (default "" $this.subdomain) $global.domain | trimPrefix "." }}

# Served through an APISIX route (see the addon's apisix-routes.yaml) like the
# portal BFF — the aggregated route also puts the host on the shared apisix
# ingress and into the apisix-tls certificate. The chart has no ingress.
page:
  publicUrl: https://{{ $host }}
  # Proves on screen WHICH instance answered, so the demo cannot be faked with
  # a local page.
  instance: {{ $global.instanceSlug }}
`,

    'values/app/development-values.yaml.gotmpl': `---
# The chart's defaults are already the development shape (one replica, no
# resource floor), so there is nothing to override here. The file still has to
# exist: the helmfile loads <profile>-values.yaml.gotmpl unconditionally.
`,

    'values/app/production-values.yaml.gotmpl': `---
replicaCount: 2
resources:
  requests:
    cpu: 10m
    memory: 32Mi
  limits:
    memory: 64Mi
`,

    'charts/hello-addon/Chart.yaml': `apiVersion: v2
name: hello-addon
description: Helm chart for the CIVITAS AppStore demo add-on
type: application
version: 0.1.0
appVersion: "1.0.0"
`,

    'charts/hello-addon/values.yaml': `replicaCount: 1

# CPU/memory requests and limits; empty means none (fine for local dev).
resources: {}

image:
  registry: docker.io
  repository: nginxinc/nginx-unprivileged
  tag: stable-alpine
  pullPolicy: IfNotPresent

service:
  type: ClusterIP
  port: 80
  # The unprivileged nginx image listens on 8080 — as a non-root user it cannot
  # bind a privileged port.
  targetPort: 8080

page:
  publicUrl: ""
  instance: ""

# Matches the platform's security defaults (see defaults/environment/security.yaml.gotmpl).
# The root filesystem stays writable: nginx needs /tmp for its pid and caches.
securityContext:
  runAsNonRoot: true
  runAsUser: 101
  allowPrivilegeEscalation: false
  capabilities:
    drop:
      - ALL
  seccompProfile:
    type: RuntimeDefault
`,

    'charts/hello-addon/templates/configmap.yaml': `apiVersion: v1
kind: ConfigMap
metadata:
  name: {{ .Release.Name }}
data:
  index.html: |
    <!doctype html>
    <html lang="de">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Hello Add-on — CIVITAS AppStore</title>
        <style>
          :root { color-scheme: light dark; }
          body {
            margin: 0; min-height: 100vh; display: grid; place-items: center;
            font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
            background: #f6f8fa; color: #11181c;
          }
          main {
            max-width: 34rem; padding: 2.5rem; border-radius: 1rem;
            background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.08);
            border-top: 4px solid #016aa1;
          }
          h1 { margin: 0 0 .5rem; font-size: 1.6rem; }
          p { margin: 0 0 1rem; line-height: 1.6; color: #4a5568; }
          dl { display: grid; grid-template-columns: auto 1fr; gap: .4rem 1rem;
               margin: 1.5rem 0 0; padding-top: 1.25rem; border-top: 1px solid #e6e8eb;
               font-size: .9rem; }
          dt { color: #6b7280; }
          dd { margin: 0; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
          @media (prefers-color-scheme: dark) {
            body { background: #0d1117; color: #e6edf3; }
            main { background: #161b22; box-shadow: none; }
            p { color: #9aa4b2; }
            dl { border-top-color: #30363d; }
          }
        </style>
      </head>
      <body>
        <main>
          <h1>Dieses Add-on kam aus dem AppStore.</h1>
          <p>
            Es wurde als Pull Request in das Deployment-Repository dieser Instanz
            vorgeschlagen, von einer Person freigegeben und anschließend
            ausgerollt. Diese Seite ist der Beweis, dass der Weg funktioniert.
          </p>
          <dl>
            <dt>Instanz</dt>
            <dd>{{ .Values.page.instance | default "—" }}</dd>
            <dt>Adresse</dt>
            <dd>{{ .Values.page.publicUrl | default "—" }}</dd>
          </dl>
        </main>
      </body>
    </html>
`,

    'charts/hello-addon/templates/deployment.yaml': `apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ .Release.Name }}
  labels:
    app: {{ .Release.Name }}
spec:
  replicas: {{ .Values.replicaCount }}
  selector:
    matchLabels:
      app: {{ .Release.Name }}
  template:
    metadata:
      labels:
        app: {{ .Release.Name }}
      annotations:
        # Roll the pods when the page content changes.
        checksum/config: {{ include (print $.Template.BasePath "/configmap.yaml") . | sha256sum }}
    spec:
      containers:
        - name: {{ .Chart.Name }}
          image: "{{ .Values.image.registry }}/{{ .Values.image.repository }}:{{ .Values.image.tag }}"
          imagePullPolicy: {{ .Values.image.pullPolicy }}
          ports:
            - name: http
              containerPort: {{ .Values.service.targetPort }}
          securityContext:
            {{- toYaml .Values.securityContext | nindent 12 }}
          resources:
            {{- toYaml .Values.resources | nindent 12 }}
          readinessProbe:
            httpGet:
              path: /
              port: http
          volumeMounts:
            - name: page
              mountPath: /usr/share/nginx/html
              readOnly: true
      volumes:
        - name: page
          configMap:
            name: {{ .Release.Name }}
`,

    'charts/hello-addon/templates/service.yaml': `apiVersion: v1
kind: Service
metadata:
  name: {{ .Release.Name }}
spec:
  type: {{ .Values.service.type }}
  ports:
    - port: {{ .Values.service.port }}
      targetPort: {{ .Values.service.targetPort }}
      protocol: TCP
      name: http
  selector:
    app: {{ .Release.Name }}
`,
}
