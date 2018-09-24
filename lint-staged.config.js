module.exports = {
    ignore: ['package.json', 'package-lock.json'],
    linters: {
        '*.{ts,js,json,md}': ['prettier --write', 'git add'],
        '*.ts': ['tslint -p tsconfig.json'],
    },
};
