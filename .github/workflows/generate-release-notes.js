import pkg from "../../package.json" with { type: "json" };

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

console.log(notes);
