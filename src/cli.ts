#!/usr/bin/env node

/**
 * Sol2Move CLI
 * Solidity to Aptos Move v2 Transpiler
 */

import { Command } from 'commander';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, basename } from 'path';
import chalk from 'chalk';
import { transpile, validate, analyze } from './transpiler.js';
import { compileCheckModules, isCompilerAvailable } from './compiler/move-compiler.js';

const program = new Command();

program
  .name('sol2move')
  .description('Transpile Solidity contracts to Aptos Move v2')
  .version('1.0.0');

// Convert command
program
  .command('convert')
  .description('Convert Solidity file to Move')
  .argument('<file>', 'Solidity source file (.sol)')
  .option('-o, --output <dir>', 'Output directory', './move_output')
  .option('-a, --address <address>', 'Module address', '0x1')
  .option('-n, --name <name>', 'Package name')
  .option('--no-toml', 'Skip generating Move.toml')
  .option('--fungible-asset', 'Use Fungible Asset standard for ERC-20 tokens')
  .option('--digital-asset', 'Use Digital Asset standard for ERC-721 tokens')
  .option('--format', 'Format output with aptos move fmt (requires Aptos CLI)')
  .option('--compile-check', 'Verify output compiles with aptos move compile (requires Aptos CLI)')
  .option('--specs', 'Generate Move Specification Language (MSL) spec blocks')
  .option('--optimize <level>', 'Parallelization optimization level: low, medium, high', 'low')
  .action(async (file: string, options: any) => {
    try {
      if (!existsSync(file)) {
        console.error(chalk.red(`Error: File not found: ${file}`));
        process.exit(1);
      }

      const source = readFileSync(file, 'utf-8');
      const packageName = options.name || basename(file, '.sol').toLowerCase();

      console.log(chalk.blue(`Transpiling ${file}...`));

      const result = transpile(source, {
        moduleAddress: options.address,
        generateToml: options.toml !== false,
        packageName,
        useFungibleAsset: options.fungibleAsset || false,
        useDigitalAsset: options.digitalAsset || false,
        format: options.format || false,
        generateSpecs: options.specs || false,
        optimizationLevel: options.optimize || 'low',
      });

      if (!result.success) {
        console.error(chalk.red('Transpilation failed:'));
        result.errors.forEach(e => console.error(chalk.red(`  - ${e}`)));
        process.exit(1);
      }

      if (result.warnings.length > 0) {
        console.log(chalk.yellow('Warnings:'));
        result.warnings.forEach(w => console.log(chalk.yellow(`  - ${w}`)));
      }

      const outDir = options.output;
      const sourcesDir = join(outDir, 'sources');

      if (!existsSync(outDir)) {
        mkdirSync(outDir, { recursive: true });
      }
      if (!existsSync(sourcesDir)) {
        mkdirSync(sourcesDir, { recursive: true });
      }

      if (result.moveToml) {
        const tomlPath = join(outDir, 'Move.toml');
        writeFileSync(tomlPath, result.moveToml);
        console.log(chalk.green(`Created: ${tomlPath}`));
      }

      for (const module of result.modules) {
        const modulePath = join(sourcesDir, `${module.name}.move`);
        writeFileSync(modulePath, module.code);
        console.log(chalk.green(`Created: ${modulePath}`));
      }

      console.log(chalk.green(`\nSuccessfully transpiled ${result.modules.length} module(s)`));

      // Compile-check if requested
      if (options.compileCheck) {
        if (!isCompilerAvailable()) {
          console.log(chalk.yellow('\nSkipping compile check: Aptos CLI not found'));
        } else {
          console.log(chalk.blue('\nRunning compile check...'));
          const compileResult = compileCheckModules(
            result.modules.map(m => ({ name: m.name, code: m.code })),
            {
              moduleAddress: options.address,
              packageName,
            }
          );

          if (compileResult.success) {
            console.log(chalk.green('Compile check passed'));
            if (compileResult.warnings.length > 0) {
              compileResult.warnings.forEach(w =>
                console.log(chalk.yellow(`  Warning: ${w.message}`))
              );
            }
          } else {
            console.log(chalk.red('Compile check failed:'));
            compileResult.errors.forEach(e => {
              const loc = e.line ? ` (${e.source || ''}:${e.line}:${e.column || ''})` : '';
              console.error(chalk.red(`  ${e.message}${loc}`));
            });
          }
        }
      }

      console.log(chalk.blue(`\nTo compile: cd ${outDir} && aptos move compile`));

    } catch (error) {
      console.error(chalk.red(`Error: ${error instanceof Error ? error.message : error}`));
      process.exit(1);
    }
  });

// Validate command
program
  .command('validate')
  .description('Validate Solidity file without transpiling')
  .argument('<file>', 'Solidity source file (.sol)')
  .action((file: string) => {
    try {
      if (!existsSync(file)) {
        console.error(chalk.red(`Error: File not found: ${file}`));
        process.exit(1);
      }

      const source = readFileSync(file, 'utf-8');
      const result = validate(source);

      if (result.valid) {
        console.log(chalk.green('Valid Solidity file'));
        console.log(chalk.blue('Contracts found:'));
        result.contracts.forEach(c => console.log(`  - ${c}`));
      } else {
        console.error(chalk.red('Invalid Solidity file:'));
        result.errors.forEach(e => console.error(chalk.red(`  - ${e}`)));
        process.exit(1);
      }
    } catch (error) {
      console.error(chalk.red(`Error: ${error instanceof Error ? error.message : error}`));
      process.exit(1);
    }
  });

// Analyze command
program
  .command('analyze')
  .description('Analyze Solidity file and show structure')
  .argument('<file>', 'Solidity source file (.sol)')
  .action((file: string) => {
    try {
      if (!existsSync(file)) {
        console.error(chalk.red(`Error: File not found: ${file}`));
        process.exit(1);
      }

      const source = readFileSync(file, 'utf-8');
      const result = analyze(source);

      if (!result.valid) {
        console.error(chalk.red('Parse errors:'));
        result.errors.forEach(e => console.error(chalk.red(`  - ${e}`)));
        process.exit(1);
      }

      console.log(chalk.blue('Contract Analysis:\n'));

      for (const contract of result.contracts) {
        console.log(chalk.green(`${contract.kind}: ${contract.name}`));

        if (contract.stateVariables.length > 0) {
          console.log(chalk.white('  State Variables:'));
          contract.stateVariables.forEach(v => console.log(`    - ${v}`));
        }

        if (contract.functions.length > 0) {
          console.log(chalk.white('  Functions:'));
          contract.functions.forEach(f => console.log(`    - ${f}()`));
        }

        if (contract.events.length > 0) {
          console.log(chalk.white('  Events:'));
          contract.events.forEach(e => console.log(`    - ${e}`));
        }

        console.log();
      }
    } catch (error) {
      console.error(chalk.red(`Error: ${error instanceof Error ? error.message : error}`));
      process.exit(1);
    }
  });

program.parse();
