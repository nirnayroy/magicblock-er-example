use anchor_lang::prelude::*;
use crate::state::UserAccount;

#[derive(Accounts)]
pub struct ConsumeRandomness<'info> {
    /// This check ensure that the vrf_program_identity (which is a PDA) is a signer
    /// enforcing the callback is executed by the VRF program trough CPI
    #[account(address = ephemeral_vrf_sdk::consts::VRF_PROGRAM_IDENTITY)]
    pub vrf_program_identity: Signer<'info>,

    #[account(mut)]
    pub user_account: Account<'info, UserAccount>,
}

pub fn handler(ctx: Context<ConsumeRandomness>, randomness: [u8; 32]) -> Result<()> {
    let rnd_u8 = ephemeral_vrf_sdk::rnd::random_u8_with_range(&randomness, 1, 100);
    msg!("Consuming random number: {:?}", rnd_u8);
    
    let user_account = &mut ctx.accounts.user_account;
    user_account.random_value = rnd_u8;
    
    Ok(())
}
