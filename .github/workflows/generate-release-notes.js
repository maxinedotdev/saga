const fs = require("fs");
const pkg = require("../../package.json");

const notes = `# ${pkg.name} v${pkg.version}

${pkg.description}

## Package Information
- **Name**: ${pkg.name}
- **Version**: ${pkg.version}
- **Author**: ${pkg.author}
- **License**: ${pkg.license}

## Keywords
${pkg.keywords.map(k => "- " + k).join("\n")}

## Links
- [Homepage](${pkg.homepage})
- [Repository](${pkg.repository.url})
- [Issues](${pkg.bugs.url})
`;

fs.writeFileSync("release_notes.md", notes);
