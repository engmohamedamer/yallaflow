// APD-shaped repository fixture (v0.3.9 onboarding acceptance). Modeled on a real
// internal project whose v0.3.8 init reported "greenfield": no root manifest, no Git,
// two nested Angular applications on different majors, several Spring Boot backend
// modules, container configuration, and design/requirement documents.
// Kept outside test/ so the runner does not load it as a test module.
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

async function put(root, relative, content) {
  const file = path.join(root, ...relative.split('/'));
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
}

const pom = (body) => `<?xml version="1.0" encoding="UTF-8"?>\n<project>\n  <modelVersion>4.0.0</modelVersion>\n${body}\n</project>\n`;

export async function apdFixture(prefix = 'yallaflow-apd-') {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  await put(root, 'README.md', '# APD\n\nPortal applications and shared backend services.\n');
  await put(root, 'docs/APD_LLD.pdf', '%PDF-1.4\n% low-level design (fixture bytes; never read by inspect)\n');
  await put(root, 'docs/Integration information.xlsx', 'PK\u0003\u0004 fixture bytes');
  await put(root, 'docs/architecture-overview.md', '# Architecture overview\n\nTwo Angular portals call Spring Boot services through a gateway.\n');
  await put(root, 'docs/context-diagram.odg', 'PK\u0003\u0004 fixture bytes');

  await put(root, 'frontend-beneficiary/package.json', JSON.stringify({ name: 'frontend-beneficiary', dependencies: { '@angular/core': '^16.2.12', rxjs: '~7.8.0' } }, null, 2));
  await put(root, 'frontend-beneficiary/angular.json', JSON.stringify({ version: 1, projects: {} }));
  await put(root, 'frontend-beneficiary/src/main.ts', 'import "./app/app.module";\n');
  await put(root, 'frontend-beneficiary/src/app/app.module.ts', 'export class AppModule {}\n');
  await put(root, 'frontend-beneficiary/src/app/app.component.ts', 'export class AppComponent {}\n');
  // Installed dependencies are never inventoried.
  await put(root, 'frontend-beneficiary/node_modules/@angular/core/package.json', JSON.stringify({ name: '@angular/core', version: '16.2.12' }));
  await put(root, 'frontend-beneficiary/node_modules/@angular/core/index.js', 'module.exports = {};\n');

  await put(root, 'frontend-corporate/package.json', JSON.stringify({ name: 'frontend-corporate', dependencies: { '@angular/core': '^8.0.3' } }, null, 2));
  await put(root, 'frontend-corporate/angular.json', JSON.stringify({ version: 1, projects: {} }));
  await put(root, 'frontend-corporate/src/main.ts', 'import "./app/app.component";\n');
  await put(root, 'frontend-corporate/src/app/app.component.ts', 'export class AppComponent {}\n');

  await put(root, 'backend/shared-services/pom.xml', pom(`  <parent>\n    <groupId>org.springframework.boot</groupId>\n    <artifactId>spring-boot-starter-parent</artifactId>\n    <version>2.1.3.RELEASE</version>\n  </parent>\n  <artifactId>shared-services</artifactId>`));
  await put(root, 'backend/shared-services/src/main/java/sa/apd/shared/SharedApplication.java', 'public class SharedApplication {}\n');
  await put(root, 'backend/ms-common-lib/pom.xml', pom(`  <parent>\n    <groupId>org.springframework.boot</groupId>\n    <artifactId>spring-boot-starter-parent</artifactId>\n    <version>2.7.2</version>\n  </parent>\n  <artifactId>ms-common-lib</artifactId>`));
  await put(root, 'backend/ms-common-lib/src/main/java/sa/apd/common/Common.java', 'public class Common {}\n');
  // BOM version through a same-file property.
  await put(root, 'backend/corporate/pom.xml', pom(`  <artifactId>corporate</artifactId>\n  <properties>\n    <spring-boot.version>2.7.2</spring-boot.version>\n  </properties>\n  <dependencyManagement>\n    <dependencies>\n      <dependency>\n        <groupId>org.springframework.boot</groupId>\n        <artifactId>spring-boot-dependencies</artifactId>\n        <version>\${spring-boot.version}</version>\n        <type>pom</type>\n        <scope>import</scope>\n      </dependency>\n    </dependencies>\n  </dependencyManagement>`));
  await put(root, 'backend/corporate/src/main/java/sa/apd/corporate/CorporateApplication.java', 'public class CorporateApplication {}\n');
  // Only the build plugin: Spring Boot is referenced but its version is not declared here.
  await put(root, 'backend/beneficiary/pom.xml', pom(`  <artifactId>beneficiary</artifactId>\n  <!-- <parent><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-parent</artifactId><version>9.9.9</version></parent> -->\n  <build>\n    <plugins>\n      <plugin>\n        <groupId>org.springframework.boot</groupId>\n        <artifactId>spring-boot-maven-plugin</artifactId>\n      </plugin>\n    </plugins>\n  </build>`));
  await put(root, 'backend/beneficiary/src/main/java/sa/apd/beneficiary/BeneficiaryApplication.java', 'public class BeneficiaryApplication {}\n');

  await put(root, 'docker/docker-compose.yml', 'services:\n  shared-services:\n    build: ../backend/shared-services\n');
  await put(root, 'docker/beneficiary/Dockerfile', '# beneficiary image\nFROM eclipse-temurin:11-jre\n');
  return root;
}
