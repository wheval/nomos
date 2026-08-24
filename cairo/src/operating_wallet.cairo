// Nomos's operating wallet — the account both payment flows settle into.
// Verifies secp256k1 signatures (an "eth"-type Starknet account, via
// account abstraction) rather than the native Stark curve, specifically so
// standard key-management infra (Turnkey, AWS KMS's ECC_SECG_P256K1) can
// hold the signing key instead of a raw Stark-curve key living in an env
// var. See docs/ARCHITECTURE.md "Custody & signing".
//
// Adapted from OpenZeppelin's own EthAccountUpgradeable preset
// (github.com/OpenZeppelin/cairo-contracts, tag v3.0.0,
// packages/presets/src/eth_account.cairo) with SRC9 (outside execution)
// and UpgradeableComponent dropped — deliberately minimal: no outside-
// execution delegation, no upgrade path, no key rotation beyond what
// EthAccountComponent itself provides. The wizard's `#[with_components]`
// macro shorthand isn't available at the currently-published package
// versions (openzeppelin_account/openzeppelin_introspection 3.0.0,
// openzeppelin_interfaces 2.1.0 — verified against scarbs.xyz directly),
// so this uses the traditional, confirmed-working `component!` wiring
// instead.
//
// SPDX-License-Identifier: MIT
// OpenZeppelin Contracts for Cairo v3.0.0

#[starknet::contract(account)]
mod NomosOperatingWallet {
    use openzeppelin_account::EthAccountComponent;
    use openzeppelin_interfaces::accounts::EthPublicKey;
    use openzeppelin_introspection::src5::SRC5Component;

    component!(path: EthAccountComponent, storage: eth_account, event: EthAccountEvent);
    component!(path: SRC5Component, storage: src5, event: SRC5Event);

    // EthAccount Mixin — bundles SRC6 (validate/execute), SRC6CamelOnly,
    // declarer, deployable, and public-key accessors in one embed.
    #[abi(embed_v0)]
    impl EthAccountMixinImpl = EthAccountComponent::EthAccountMixinImpl<ContractState>;
    impl EthAccountInternalImpl = EthAccountComponent::InternalImpl<ContractState>;

    #[storage]
    struct Storage {
        #[substorage(v0)]
        eth_account: EthAccountComponent::Storage,
        #[substorage(v0)]
        src5: SRC5Component::Storage,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        #[flat]
        EthAccountEvent: EthAccountComponent::Event,
        #[flat]
        SRC5Event: SRC5Component::Event,
    }

    #[constructor]
    fn constructor(ref self: ContractState, public_key: EthPublicKey) {
        self.eth_account.initializer(public_key);
    }
}
